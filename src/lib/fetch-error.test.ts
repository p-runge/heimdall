import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { categorizeErrorCode, classifyFetchError, describeTimeout, probeDns } from "./fetch-error";

function fetchFailed(cause: unknown) {
  return new TypeError("fetch failed", { cause });
}

function codeError(code: string, message = code) {
  return Object.assign(new Error(message), { code });
}

describe("categorizeErrorCode", () => {
  const cases: [string | undefined, string][] = [
    ["ENOTFOUND", "dns"],
    ["EAI_AGAIN", "dns"],
    ["ECONNREFUSED", "connect"],
    ["ECONNRESET", "connect"],
    ["UND_ERR_CONNECT_TIMEOUT", "connect"],
    ["UND_ERR_SOCKET", "connect"],
    ["CERT_HAS_EXPIRED", "tls"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "tls"],
    ["ERR_SSL_WRONG_VERSION_NUMBER", "tls"],
    ["UND_ERR_HEADERS_TIMEOUT", "timeout"],
    ["ERR_INVALID_URL", "unknown"],
    [undefined, "unknown"],
  ];

  for (const [code, expected] of cases) {
    it(`maps ${code ?? "a missing code"} to ${expected}`, () => {
      assert.equal(categorizeErrorCode(code), expected);
    });
  }
});

describe("classifyFetchError", () => {
  it("reads the code from undici's cause", () => {
    const err = fetchFailed(codeError("EAI_AGAIN", "getaddrinfo EAI_AGAIN example.com"));
    assert.deepEqual(classifyFetchError(err), {
      category: "dns",
      code: "EAI_AGAIN",
      message: "DNS lookup failed (EAI_AGAIN)",
    });
  });

  it("formats connect and TLS failures", () => {
    assert.equal(classifyFetchError(fetchFailed(codeError("ECONNREFUSED"))).message, "Connection failed (ECONNREFUSED)");
    assert.equal(classifyFetchError(fetchFailed(codeError("CERT_HAS_EXPIRED"))).message, "TLS error (CERT_HAS_EXPIRED)");
  });

  it("falls back to the first member of an AggregateError without its own code", () => {
    const err = fetchFailed(new AggregateError([codeError("ECONNREFUSED"), codeError("ECONNREFUSED")]));
    const result = classifyFetchError(err);
    assert.equal(result.category, "connect");
    assert.equal(result.code, "ECONNREFUSED");
  });

  it("keeps the innermost message for errors without a known code", () => {
    const result = classifyFetchError(fetchFailed(new Error("redirect count exceeded")));
    assert.deepEqual(result, {
      category: "unknown",
      code: undefined,
      message: "Request failed: redirect count exceeded",
    });
  });

  it("keeps an unrecognised raw code in the message", () => {
    const result = classifyFetchError(fetchFailed(codeError("ERR_SOMETHING_NEW", "something new")));
    assert.equal(result.category, "unknown");
    assert.equal(result.message, "Request failed: something new (ERR_SOMETHING_NEW)");
  });

  it("handles non-Error throwables", () => {
    assert.equal(classifyFetchError("boom").message, "Request failed: boom");
  });
});

describe("describeTimeout", () => {
  it("blames the server when DNS still resolves", () => {
    assert.equal(describeTimeout(10_000, { status: "ok" }).message, "Timed out after 10 s waiting for the server");
  });

  it("blames DNS when the follow-up lookup hangs", () => {
    assert.equal(describeTimeout(10_000, { status: "hung" }).message, "Timed out after 10 s during DNS lookup");
  });

  it("includes the code of a failing follow-up lookup", () => {
    assert.deepEqual(describeTimeout(8_000, { status: "failed", code: "EAI_AGAIN" }), {
      category: "timeout",
      code: "EAI_AGAIN",
      message: "Timed out after 8 s; DNS lookup failing (EAI_AGAIN)",
    });
  });
});

describe("probeDns", () => {
  it("reports ok when the lookup resolves", async () => {
    assert.deepEqual(await probeDns("example.com", 1_000, async () => ({})), { status: "ok" });
  });

  it("reports the code when the lookup fails", async () => {
    const result = await probeDns("example.com", 1_000, async () => {
      throw codeError("ENOTFOUND");
    });
    assert.deepEqual(result, { status: "failed", code: "ENOTFOUND" });
  });

  it("reports hung when the lookup exceeds the cap", async () => {
    const result = await probeDns("example.com", 20, () => new Promise(() => {}));
    assert.deepEqual(result, { status: "hung" });
  });

  it("skips the lookup for IP literals", async () => {
    const neverCalled = () => Promise.reject(new Error("should not resolve an IP"));
    assert.deepEqual(await probeDns("10.0.0.1", 1_000, neverCalled), { status: "ok" });
    assert.deepEqual(await probeDns("[::1]", 1_000, neverCalled), { status: "ok" });
  });
});

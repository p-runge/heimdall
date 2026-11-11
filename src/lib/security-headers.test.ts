import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASE_PROTECTIONS,
  compareWithExpectations,
  describeProtection,
  describeRegressions,
  evaluateProtections,
  isEvaluableStatus,
  parseCspDirectives,
  pickSecurityHeaders,
  regressionSeverity,
  summarizeProtections,
  type Expectation,
} from "./security-headers";

const HTTPS = "https://example.com/";

const SNB_HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
};

describe("parseCspDirectives", () => {
  it("extracts directives with their sources", () => {
    const directives = parseCspDirectives("default-src 'self'; frame-ancestors 'none'");
    assert.deepEqual([...directives.keys()], ["default-src", "frame-ancestors"]);
    assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
  });

  it("lowercases directive names and skips empty segments", () => {
    const directives = parseCspDirectives(" ; Script-Src 'self';;  ;");
    assert.deepEqual([...directives.keys()], ["script-src"]);
  });

  it("returns an empty map for missing or empty values", () => {
    assert.equal(parseCspDirectives(undefined).size, 0);
    assert.equal(parseCspDirectives("").size, 0);
  });

  it("merges several policies joined by a comma", () => {
    const directives = parseCspDirectives("script-src 'self', frame-ancestors 'self'");
    assert.ok(directives.has("script-src"));
    assert.ok(directives.has("frame-ancestors"));
  });

  it("ignores fragments that are not directive names, e.g. after a stray comma", () => {
    const directives = parseCspDirectives(
      "img-src 'self' data:, https://cdn.example.com; frame-ancestors 'self'",
    );
    assert.deepEqual([...directives.keys()], ["img-src", "frame-ancestors"]);
  });

  it("keeps the first occurrence of a repeated directive", () => {
    const directives = parseCspDirectives("frame-ancestors 'self'; frame-ancestors *");
    assert.deepEqual(directives.get("frame-ancestors"), ["'self'"]);
  });
});

describe("pickSecurityHeaders", () => {
  it("reads the six security headers and ignores the rest", () => {
    const headers = new Headers({
      "Strict-Transport-Security": "max-age=1",
      "Content-Security-Policy-Report-Only": "frame-ancestors 'none'",
      Server: "nginx",
    });
    assert.deepEqual(pickSecurityHeaders(headers), { "strict-transport-security": "max-age=1" });
  });
});

describe("evaluateProtections", () => {
  it("evaluates the full SNB header set", () => {
    assert.deepEqual(evaluateProtections(SNB_HEADERS, HTTPS), [
      "csp:base-uri",
      "csp:connect-src",
      "csp:default-src",
      "csp:font-src",
      "csp:form-action",
      "csp:frame-ancestors",
      "csp:img-src",
      "csp:object-src",
      "csp:script-src",
      "csp:style-src",
      "csp:upgrade-insecure-requests",
      "framing",
      "hsts",
      "nosniff",
      "permissions_policy",
      "referrer_policy",
    ]);
  });

  it("finds nothing without headers", () => {
    assert.deepEqual(evaluateProtections({}, HTTPS), []);
  });

  it("requires a positive HSTS max-age", () => {
    assert.deepEqual(evaluateProtections({ "strict-transport-security": "max-age=0" }, HTTPS), []);
    assert.deepEqual(
      evaluateProtections(
        { "strict-transport-security": 'max-age="31536000"; includeSubDomains' },
        HTTPS,
      ),
      ["hsts"],
    );
  });

  it("ignores HSTS on a plain-http final response", () => {
    assert.deepEqual(
      evaluateProtections({ "strict-transport-security": "max-age=31536000" }, "http://example.com/"),
      [],
    );
  });

  it("accepts nosniff regardless of case and whitespace", () => {
    assert.deepEqual(evaluateProtections({ "x-content-type-options": "NoSniff " }, HTTPS), ["nosniff"]);
    assert.deepEqual(evaluateProtections({ "x-content-type-options": "foo" }, HTTPS), []);
  });

  it("accepts headers that a proxy and the app both sent", () => {
    assert.deepEqual(
      evaluateProtections(
        { "x-content-type-options": "nosniff, nosniff", "x-frame-options": "SAMEORIGIN, SAMEORIGIN" },
        HTTPS,
      ),
      ["framing", "nosniff"],
    );
    assert.deepEqual(evaluateProtections({ "x-frame-options": "DENY, SAMEORIGIN" }, HTTPS), [
      "framing",
    ]);
    assert.deepEqual(
      evaluateProtections({ "x-frame-options": "SAMEORIGIN, ALLOW-FROM https://a.example" }, HTTPS),
      [],
    );
  });

  it("accepts X-Frame-Options DENY and SAMEORIGIN only", () => {
    assert.deepEqual(evaluateProtections({ "x-frame-options": "DENY" }, HTTPS), ["framing"]);
    assert.deepEqual(evaluateProtections({ "x-frame-options": "sameorigin" }, HTTPS), ["framing"]);
    assert.deepEqual(
      evaluateProtections({ "x-frame-options": "ALLOW-FROM https://a.example" }, HTTPS),
      [],
    );
  });

  it("treats frame-ancestors without a wildcard as framing protection", () => {
    assert.deepEqual(
      evaluateProtections({ "content-security-policy": "frame-ancestors 'self'" }, HTTPS),
      ["csp:frame-ancestors", "framing"],
    );
    assert.deepEqual(
      evaluateProtections({ "content-security-policy": "frame-ancestors *" }, HTTPS),
      ["csp:frame-ancestors"],
    );
    assert.deepEqual(
      evaluateProtections({ "content-security-policy": "frame-ancestors" }, HTTPS),
      ["csp:frame-ancestors", "framing"],
    );
  });

  it("rejects Referrer-Policy unsafe-url", () => {
    assert.deepEqual(evaluateProtections({ "referrer-policy": "unsafe-url" }, HTTPS), []);
    assert.deepEqual(evaluateProtections({ "referrer-policy": "no-referrer" }, HTTPS), [
      "referrer_policy",
    ]);
  });

  it("detects Permissions-Policy", () => {
    assert.deepEqual(evaluateProtections({ "permissions-policy": "camera=()" }, HTTPS), [
      "permissions_policy",
    ]);
  });
});

describe("isEvaluableStatus", () => {
  it("only accepts 2xx", () => {
    assert.equal(isEvaluableStatus(200), true);
    assert.equal(isEvaluableStatus(204), true);
    for (const status of [301, 403, 404, 503]) assert.equal(isEvaluableStatus(status), false);
  });
});

describe("compareWithExpectations", () => {
  it("expects every protection seen for the first time", () => {
    assert.deepEqual(compareWithExpectations(["nosniff"], []), {
      newlyExpected: ["nosniff"],
      regressions: [],
    });
  });

  it("never regresses a site that never sent headers", () => {
    assert.deepEqual(compareWithExpectations([], []), { newlyExpected: [], regressions: [] });
  });

  it("reports a lost expected protection", () => {
    const expectations: Expectation[] = [{ protectionKey: "hsts", status: "expected" }];
    assert.deepEqual(compareWithExpectations([], expectations), {
      newlyExpected: [],
      regressions: ["hsts"],
    });
  });

  it("never regresses a disabled protection", () => {
    const expectations: Expectation[] = [{ protectionKey: "hsts", status: "disabled" }];
    assert.deepEqual(compareWithExpectations([], expectations), { newlyExpected: [], regressions: [] });
    assert.deepEqual(compareWithExpectations(["hsts"], expectations), {
      newlyExpected: [],
      regressions: [],
    });
  });
});

describe("regressionSeverity", () => {
  it("is critical only for HSTS or framing", () => {
    assert.equal(regressionSeverity(["nosniff"]), "warning");
    assert.equal(regressionSeverity(["csp:frame-ancestors"]), "warning");
    assert.equal(regressionSeverity(["nosniff", "framing"]), "critical");
    assert.equal(regressionSeverity(["hsts"]), "critical");
  });
});

describe("describeProtection", () => {
  it("labels known keys and CSP directives", () => {
    assert.equal(describeProtection("hsts"), "HSTS");
    assert.equal(describeProtection("nosniff"), "X-Content-Type-Options: nosniff");
    assert.equal(describeProtection("framing"), "Framing protection");
    assert.equal(describeProtection("referrer_policy"), "Referrer-Policy");
    assert.equal(describeProtection("permissions_policy"), "Permissions-Policy");
    assert.equal(describeProtection("csp:frame-ancestors"), "CSP frame-ancestors");
  });
});

describe("describeRegressions", () => {
  it("lists every lost protection", () => {
    assert.equal(
      describeRegressions("SNB Law Website", ["hsts", "csp:frame-ancestors"]),
      "SNB Law Website: lost HSTS, CSP frame-ancestors",
    );
  });
});

describe("summarizeProtections", () => {
  it("shows the base protections as missing for a site without headers", () => {
    assert.deepEqual(
      summarizeProtections([], []),
      BASE_PROTECTIONS.map((key) => ({ key, state: "missing" })),
    );
  });

  it("derives lost, disabled and present states", () => {
    const expectations: Expectation[] = [
      { protectionKey: "csp:script-src", status: "expected" },
      { protectionKey: "hsts", status: "disabled" },
      { protectionKey: "framing", status: "disabled" },
    ];
    assert.deepEqual(summarizeProtections(["framing", "nosniff", "permissions_policy"], expectations), [
      { key: "hsts", state: "disabled" },
      { key: "nosniff", state: "present" },
      { key: "framing", state: "disabled_present" },
      { key: "referrer_policy", state: "missing" },
      { key: "csp:script-src", state: "lost" },
      { key: "permissions_policy", state: "present" },
    ]);
  });
});

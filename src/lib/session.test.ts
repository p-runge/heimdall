import { test } from "node:test";
import assert from "node:assert/strict";
import { isSignedIn } from "./session";

test("accepts a session with a signed-in user", () => {
  assert.equal(isSignedIn({ user: { email: "someone@example.com" }, expires: "2026-12-01" }), true);
});

test("rejects a missing session", () => {
  assert.equal(isSignedIn(null), false);
  assert.equal(isSignedIn(undefined), false);
});

// When Auth.js fails internally (e.g. UntrustedHost), auth() and req.auth
// carry this error body instead of null.
test("rejects the error body Auth.js returns when the session check fails", () => {
  assert.equal(isSignedIn({ message: "There was a problem with the server configuration." }), false);
});

test("rejects a session without a user email", () => {
  assert.equal(isSignedIn({ user: {}, expires: "2026-12-01" }), false);
  assert.equal(isSignedIn({ user: { email: "" }, expires: "2026-12-01" }), false);
});

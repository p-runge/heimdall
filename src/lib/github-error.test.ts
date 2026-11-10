import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { friendlyGithubError, isGithubAuthError } from "./github-error";

function githubError(status: number, message: string, headers: Record<string, string> = {}) {
  return Object.assign(new Error(message), { status, response: { headers } });
}

const context = {
  action: "Couldn't list pull requests for owner/repo",
  permission: "Pull requests",
  notFound: 'Branch "main" doesn\'t exist in owner/repo',
};

describe("friendlyGithubError", () => {
  it("blames the token on 401", () => {
    const message = friendlyGithubError(githubError(401, "Bad credentials"), context);
    assert.match(message, /^Couldn't list pull requests for owner\/repo: GitHub rejected the token/);
    assert.match(message, /GITHUB_TOKEN/);
  });

  it("names the missing permission on 403", () => {
    const err = githubError(403, "Resource not accessible by personal access token");
    assert.match(friendlyGithubError(err, context), /"Pull requests: Read-only"/);
  });

  it("passes a rate-limit 403 through instead of blaming permissions", () => {
    const err = githubError(403, "API rate limit exceeded", { "x-ratelimit-remaining": "0" });
    assert.equal(
      friendlyGithubError(err, context),
      "Couldn't list pull requests for owner/repo: API rate limit exceeded",
    );
  });

  it("uses the not-found message on 404", () => {
    assert.match(friendlyGithubError(githubError(404, "Not Found"), context), /^Branch "main" doesn't exist/);
  });

  it("falls back to the action on 404 without a not-found message", () => {
    assert.equal(
      friendlyGithubError(githubError(404, "Not Found"), { action: context.action, permission: context.permission }),
      "Couldn't list pull requests for owner/repo: Not Found",
    );
  });

  it("keeps the original message for other errors", () => {
    assert.equal(
      friendlyGithubError(new Error("socket hang up"), context),
      "Couldn't list pull requests for owner/repo: socket hang up",
    );
  });
});

describe("isGithubAuthError", () => {
  it("is true for 401 and permission 403s", () => {
    assert.equal(isGithubAuthError(githubError(401, "Bad credentials")), true);
    assert.equal(isGithubAuthError(githubError(403, "Resource not accessible")), true);
  });

  it("is false for rate limits, 404s and non-HTTP errors", () => {
    assert.equal(isGithubAuthError(githubError(403, "rate", { "x-ratelimit-remaining": "0" })), false);
    assert.equal(isGithubAuthError(githubError(404, "Not Found")), false);
    assert.equal(isGithubAuthError(new Error("boom")), false);
  });
});

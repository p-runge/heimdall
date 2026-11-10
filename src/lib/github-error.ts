type GithubErrorContext = {
  /** What was being attempted, e.g. `Couldn't list pull requests for owner/repo`. */
  action: string;
  /** Fine-grained token permission the request needs, e.g. "Pull requests". */
  permission: string;
  /** Message for a 404, which GitHub also returns for private repos the token can't see. */
  notFound?: string;
};

function errorStatus(err: unknown) {
  return err && typeof err === "object" && "status" in err ? err.status : undefined;
}

function isRateLimited(err: unknown) {
  if (!err || typeof err !== "object" || !("response" in err)) return false;
  const response = err.response as { headers?: Record<string, string | undefined> } | undefined;
  return response?.headers?.["x-ratelimit-remaining"] === "0";
}

/** True when the error means the token itself is the problem, not the repo or the request. */
export function isGithubAuthError(err: unknown) {
  const status = errorStatus(err);
  return status === 401 || (status === 403 && !isRateLimited(err));
}

export function friendlyGithubError(err: unknown, { action, permission, notFound }: GithubErrorContext) {
  const status = errorStatus(err);
  if (status === 401) {
    return `${action}: GitHub rejected the token as invalid, expired or revoked. Update GITHUB_TOKEN.`;
  }
  // Rate limiting also answers 403, but has nothing to do with permissions.
  if (status === 403 && !isRateLimited(err)) {
    return `${action}: the token isn't allowed to do this. Grant it "${permission}: Read-only" on this repository.`;
  }
  if (status === 404 && notFound) return `${notFound} — check that it exists and the token can access it.`;
  return `${action}: ${err instanceof Error ? err.message : String(err)}`;
}

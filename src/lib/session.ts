// Auth.js does not return null when its own session check fails: auth() and
// the proxy's req.auth then carry an error body like `{ message: "..." }`,
// which is truthy. Only a session with a user email counts as signed in.
export function isSignedIn(session: unknown): session is { user: { email: string } } {
  if (!session || typeof session !== "object") return false;
  const user = (session as { user?: { email?: unknown } }).user;
  return typeof user?.email === "string" && user.email.length > 0;
}

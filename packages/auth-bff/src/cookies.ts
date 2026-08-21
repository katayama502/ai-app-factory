export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) result[name] = decodeURIComponent(value);
  }
  return result;
}

/**
 * The `__Host-` cookie-name prefix REQUIRES `Secure` (and forbids `Domain=`) — it
 * cannot be used at all over plain HTTP, which is what local dev runs on today (no
 * TLS yet — see ROADMAP.md). Rather than either hard-require HTTPS to run locally at
 * all, or silently ship a cookie with none of `__Host-`'s guarantees, this picks the
 * strongest option the current connection actually supports and names the cookie
 * accordingly, so the gap is visible in the cookie name itself rather than hidden.
 */
export function sessionCookieName(isSecure: boolean): string {
  return isSecure ? "__Host-aiaf_session" : "aiaf_session";
}

export function buildSessionCookie(name: string, value: string, isSecure: boolean, maxAgeSeconds: number): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}

export function buildExpiredCookie(name: string, isSecure: boolean): string {
  const parts = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}

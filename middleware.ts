/**
 * Edge-safe gate for /admin: a missing session cookie gets a hard 307 to the
 * login page BEFORE any rendering starts. This is deliberately a presence
 * check only - HMAC verification needs node:crypto, which the middleware
 * runtime does not have, so the page itself remains the authority: a forged
 * cookie passes here and is rejected by verifySessionToken in app/admin.
 *
 * Without this, the server component's redirect() can arrive after the
 * streamed shell has flushed (status already 200). No data ever leaked - the
 * panels only render after verification - but the browser saw a flash of
 * empty shell instead of a clean redirect.
 */
import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const has = !!request.cookies.get("gebo_admin")?.value;
  if (!has) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/((?!login).*)"],
};

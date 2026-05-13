import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/resident", "/report"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow public paths, Next.js internals, static files and API routes
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Allow the request through if EITHER auth cookie is present.
  //
  // The access_token has a short lifetime (default 60 min). Once it expires
  // the browser stops sending it, but the refresh_token cookie is still
  // valid for days. If we redirected to /login on access-token absence
  // alone, expiry of the short-lived token would forcibly log the user out
  // before the axios refresh interceptor in lib/api.ts ever ran.
  //
  // The interceptor handles the actual refresh: any protected API call that
  // returns 401 silently calls /api/auth/refresh, retries the request, and
  // only fires `imads:auth-lost` (handled by AuthProvider/AppShell) when
  // refresh itself fails.
  const accessToken = request.cookies.get("access_token")?.value;
  const refreshToken = request.cookies.get("refresh_token")?.value;

  if (!accessToken && !refreshToken) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

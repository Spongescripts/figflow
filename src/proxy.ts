import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "ff_owner";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Only mark the cookie Secure over HTTPS: a Secure cookie sent over plain http is dropped, and every upload then 404s. */
function isHttps(req: NextRequest): boolean {
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return (forwarded ?? req.nextUrl.protocol.replace(":", "")) === "https";
}

/**
 * Gives every browser its owner cookie before the route runs. The new token is also put on the
 * forwarded request, so the route handler sees the same token the browser will store. (Before,
 * the handler saw no cookie, minted a second one, and the browser could keep the other: the
 * upload then belonged to a cookie nobody had, and every request for it was "Not found".)
 */
export function proxy(req: NextRequest) {
  const existing = req.cookies.get(COOKIE)?.value;
  if (existing && TOKEN.test(existing)) return NextResponse.next();
  const token = newToken();
  req.cookies.set(COOKIE, token);
  const headers = new Headers(req.headers);
  headers.set("cookie", req.cookies.toString());
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/convert/:path*", "/start", "/api/uploads/:path*", "/api/session"],
};

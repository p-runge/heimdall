import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isSignedIn } from "@/lib/session";

export const proxy = auth((req) => {
  if (!isSignedIn(req.auth)) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/((?!api/auth|api/cron|login|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|icon-.*\\.png|manifest.webmanifest).*)"],
};

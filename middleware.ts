import { NextRequest, NextResponse } from "next/server";

function looksLikeAuthCallback(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return (
    params.has("code")
    || params.has("token_hash")
    || params.has("error")
    || params.has("error_description")
  );
}

function isRecoveryFlow(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return (
    params.get("type") === "recovery"
    || params.get("mode") === "reset"
    || params.has("token_hash")
  );
}

export function middleware(request: NextRequest) {
  if (!looksLikeAuthCallback(request)) {
    return NextResponse.next();
  }

  const targetPath = isRecoveryFlow(request) ? "/reset-password" : "/auth";
  if (request.nextUrl.pathname === targetPath) {
    return NextResponse.next();
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = targetPath;
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

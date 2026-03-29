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

function applyFreshEntryHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Clear-Site-Data", "\"cache\"");
  return response;
}

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/setup" || request.nextUrl.pathname === "/auth") {
    return applyFreshEntryHeaders(NextResponse.next());
  }

  if (!looksLikeAuthCallback(request)) {
    return NextResponse.next();
  }

  const targetPath = isRecoveryFlow(request) ? "/reset-password" : "/auth";
  if (request.nextUrl.pathname === targetPath) {
    return applyFreshEntryHeaders(NextResponse.next());
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = targetPath;
  return applyFreshEntryHeaders(NextResponse.redirect(redirectUrl));
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

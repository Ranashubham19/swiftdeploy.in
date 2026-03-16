import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GOOGLE_LOGIN_SESSION_COOKIE = "clawcloud-google-login-session";

type GoogleLoginBridgePayload = {
  access_token?: string;
  refresh_token?: string;
  token_hash?: string;
  type?: "magiclink";
};

function withNoStoreHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export async function GET(request: NextRequest) {
  const encoded = request.cookies.get(GOOGLE_LOGIN_SESSION_COOKIE)?.value?.trim() ?? "";

  if (!encoded) {
    return withNoStoreHeaders(
      NextResponse.json({ error: "Missing Google login bridge session." }, { status: 400 }),
    );
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf-8"),
    ) as GoogleLoginBridgePayload;

    const hasSession = Boolean(parsed.access_token && parsed.refresh_token);
    const hasMagicLink = Boolean(parsed.token_hash && parsed.type === "magiclink");

    if (!hasSession && !hasMagicLink) {
      throw new Error("Incomplete Google login bridge session.");
    }

    const response = withNoStoreHeaders(
      NextResponse.json(
        hasSession
          ? {
              access_token: parsed.access_token,
              refresh_token: parsed.refresh_token,
            }
          : {
              token_hash: parsed.token_hash,
              type: parsed.type,
            },
      ),
    );
    response.cookies.delete(GOOGLE_LOGIN_SESSION_COOKIE);
    return response;
  } catch (error) {
    const response = withNoStoreHeaders(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid Google login bridge session." },
        { status: 400 },
      ),
    );
    response.cookies.delete(GOOGLE_LOGIN_SESSION_COOKIE);
    return response;
  }
}

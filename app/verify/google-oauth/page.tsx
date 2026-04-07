import type { Metadata } from "next";

import { GoogleOauthReviewPage } from "@/components/google-oauth-review-page";
import { getPublicAppConfig } from "@/lib/env";

export const metadata: Metadata = {
  title: "Google OAuth Review - ClawCloud",
  description: "Public Google OAuth reviewer path for ClawCloud sign-in and Workspace consent.",
};

export const dynamic = "force-dynamic";

export default function GoogleOauthReviewRoute() {
  return <GoogleOauthReviewPage config={getPublicAppConfig()} />;
}

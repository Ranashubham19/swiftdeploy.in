import type { Metadata } from "next";

import { AuthPage } from "@/components/auth-page";
import { getPublicAppConfig } from "@/lib/env";

export const metadata: Metadata = {
  title: "ClawCloud - Sign in",
  description: "Sign in or create your ClawCloud account with Google or email.",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function AuthRoute() {
  return <AuthPage config={getPublicAppConfig()} />;
}

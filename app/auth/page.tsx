import type { Metadata } from "next";

import { AuthPage } from "@/components/auth-page";
import { getPublicAppConfig } from "@/lib/env";

export const metadata: Metadata = {
  title: "ClawCloud - Sign in",
  description: "Sign in or create your ClawCloud account with Google or email.",
};

export default function AuthRoute() {
  return <AuthPage config={getPublicAppConfig()} />;
}

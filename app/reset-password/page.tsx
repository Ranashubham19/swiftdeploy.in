import type { Metadata } from "next";

import { ResetPasswordPage } from "@/components/reset-password-page";
import { getPublicAppConfig } from "@/lib/env";

export const metadata: Metadata = {
  title: "ClawCloud - Reset password",
  description: "Set a new password for your ClawCloud account.",
};

export default function ResetPasswordRoute() {
  return <ResetPasswordPage config={getPublicAppConfig()} />;
}

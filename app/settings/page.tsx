import type { Metadata } from "next";

import { SettingsPage } from "@/components/settings-page";
import { getPublicAppConfig } from "@/lib/env";

export const metadata: Metadata = {
  title: "ClawCloud - Settings",
  description: "Account settings for your ClawCloud workspace.",
};

export default function SettingsRoute() {
  return <SettingsPage config={getPublicAppConfig()} />;
}

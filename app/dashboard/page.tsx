import type { Metadata } from "next";

import { DashboardShell } from "@/components/dashboard-shell";
import { getPublicAppConfig } from "@/lib/env";

export const metadata: Metadata = {
  title: "ClawCloud - Dashboard",
  description: "Authenticated dashboard for ClawCloud.",
};

export default function DashboardRoute() {
  return <DashboardShell config={getPublicAppConfig()} />;
}

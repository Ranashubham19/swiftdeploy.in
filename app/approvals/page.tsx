import type { Metadata } from "next";

import { ApprovalsPage } from "@/components/approvals-page";
import { getPublicAppConfig } from "@/lib/env";

export const metadata: Metadata = {
  title: "ClawCloud - Reply approvals",
  description: "Review AI drafted email replies before sending them.",
};

export default function ApprovalsRoute() {
  return <ApprovalsPage config={getPublicAppConfig()} />;
}

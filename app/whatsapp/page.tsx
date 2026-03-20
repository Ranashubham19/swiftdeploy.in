import type { Metadata } from "next";

import { WhatsAppControlCenter } from "@/components/whatsapp-control-center";
import { getPublicAppConfig } from "@/lib/env";

export const metadata: Metadata = {
  title: "ClawCloud - Advanced WhatsApp Workspace",
  description: "Advanced WhatsApp approvals, history, workflows, privacy, and governance controls.",
};

export default function WhatsAppControlCenterRoute() {
  return <WhatsAppControlCenter config={getPublicAppConfig()} />;
}

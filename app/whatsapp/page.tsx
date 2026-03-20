import type { Metadata } from "next";

import { WhatsAppControlCenter } from "@/components/whatsapp-control-center";

export const metadata: Metadata = {
  title: "ClawCloud - WhatsApp Control Center",
  description: "Manage WhatsApp automation, approvals, history, and inbox priorities.",
};

export default function WhatsAppControlCenterRoute() {
  return <WhatsAppControlCenter />;
}

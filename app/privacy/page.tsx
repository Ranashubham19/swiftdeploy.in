import type { Metadata } from "next";

import { PrivacyPage } from "@/components/privacy-page";

export const metadata: Metadata = {
  title: "Privacy Policy - ClawCloud",
  description: "How ClawCloud collects, uses, and protects your personal data.",
};

export default function PrivacyRoute() {
  return <PrivacyPage />;
}

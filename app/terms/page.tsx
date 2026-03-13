import type { Metadata } from "next";

import { TermsPage } from "@/components/terms-page";

export const metadata: Metadata = {
  title: "Terms of Service - ClawCloud",
  description: "ClawCloud terms of service, acceptable use, and billing policy.",
};

export default function TermsRoute() {
  return <TermsPage />;
}

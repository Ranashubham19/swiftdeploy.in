import { Suspense } from "react";
import type { Metadata } from "next";

import { SetupPage } from "@/components/setup-page";
import { getPublicAppConfig } from "@/lib/env";

export const metadata: Metadata = {
  title: "ClawCloud - Setup your agent",
  description: "Link WhatsApp and choose your WhatsApp tasks for ClawCloud.",
};

export default function OnboardingRoute() {
  return (
    <Suspense fallback={null}>
      <SetupPage config={getPublicAppConfig()} />
    </Suspense>
  );
}

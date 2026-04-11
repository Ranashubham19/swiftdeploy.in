import type { Metadata } from "next";

import {
  SetupGuidePage,
  isSetupGuideTopic,
} from "@/components/setup-guide-page";

export const metadata: Metadata = {
  title: "ClawCloud - Setup guide",
  description: "Step-by-step help for linking WhatsApp and choosing WhatsApp tasks in ClawCloud setup.",
};

type SetupGuideRouteProps = {
  searchParams: Promise<{
    topic?: string;
  }>;
};

export default async function SetupGuideRoute({ searchParams }: SetupGuideRouteProps) {
  const params = await searchParams;
  const topic = isSetupGuideTopic(params.topic) ? params.topic : "whatsapp-connect";

  return <SetupGuidePage topic={topic} />;
}

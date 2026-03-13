import type { Metadata } from "next";

import { ActivityLogPage } from "@/components/activity-log";
import { getPublicAppConfig } from "@/lib/env";

export const metadata: Metadata = {
  title: "ClawCloud - Activity log",
  description: "Review recent ClawCloud task runs, stats, and failures.",
};

export default function ActivityRoute() {
  return <ActivityLogPage config={getPublicAppConfig()} />;
}

export type BotAlertSeverity = "info" | "warning" | "critical";

export type BotAlert = {
  id: string;
  botId: string;
  code: string;
  severity: BotAlertSeverity;
  message: string;
  createdAt: number;
  updatedAt: number;
  metric?: number;
};

export type BotHealthSnapshot = {
  botId: string;
  ownerEmail?: string;
  platform?: string;
  messageCount: number;
  responseCount: number;
  errorCount: number;
  totalLatencyMs: number;
  latencySamples: number;
  tokenUsage: number;
  creditRemainingUsd?: number;
  creditDepleted?: boolean;
  nowMs?: number;
};

export const createBotAlertMonitor = (options?: {
  windowMs?: number;
  maxAlerts?: number;
  latencyWarnMs?: number;
  errorRateWarn?: number;
  minSamplesForErrorRate?: number;
}) => {
  const windowMs = Math.max(60_000, options?.windowMs ?? 10 * 60 * 1000);
  const maxAlerts = Math.max(100, options?.maxAlerts ?? 5000);
  const latencyWarnMs = Math.max(500, options?.latencyWarnMs ?? 6000);
  const errorRateWarn = Math.min(1, Math.max(0.05, options?.errorRateWarn ?? 0.25));
  const minSamplesForErrorRate = Math.max(3, options?.minSamplesForErrorRate ?? 8);

  const latestAlerts = new Map<string, BotAlert>();
  const snapshots = new Map<string, BotHealthSnapshot & { observedAt: number }>();

  const upsertAlert = (
    botId: string,
    code: string,
    severity: BotAlertSeverity,
    message: string,
    metric?: number,
  ): void => {
    const key = `${botId}:${code}`;
    const now = Date.now();
    const existing = latestAlerts.get(key);
    if (existing) {
      existing.updatedAt = now;
      existing.severity = severity;
      existing.message = message;
      existing.metric = metric;
      latestAlerts.set(key, existing);
      return;
    }
    latestAlerts.set(key, {
      id: `${key}:${now}`,
      botId,
      code,
      severity,
      message,
      createdAt: now,
      updatedAt: now,
      metric,
    });
    if (latestAlerts.size > maxAlerts) {
      const oldestKey = latestAlerts.keys().next().value as string | undefined;
      if (oldestKey) latestAlerts.delete(oldestKey);
    }
  };

  const observe = (snapshot: BotHealthSnapshot): void => {
    const now = snapshot.nowMs ?? Date.now();
    const prev = snapshots.get(snapshot.botId);
    snapshots.set(snapshot.botId, { ...snapshot, observedAt: now });

    if (snapshot.creditDepleted || (snapshot.creditRemainingUsd ?? Infinity) <= 0) {
      upsertAlert(
        snapshot.botId,
        "CREDIT_DEPLETED",
        "critical",
        "Bot credit is depleted and may stop replying.",
        Number(snapshot.creditRemainingUsd ?? 0),
      );
    } else if ((snapshot.creditRemainingUsd ?? Infinity) <= 2) {
      upsertAlert(
        snapshot.botId,
        "CREDIT_LOW",
        "warning",
        "Bot credit is low. Recharge recommended soon.",
        Number(snapshot.creditRemainingUsd ?? 0),
      );
    }

    if (snapshot.latencySamples > 0) {
      const avgLatencyMs = snapshot.totalLatencyMs / Math.max(1, snapshot.latencySamples);
      if (avgLatencyMs >= latencyWarnMs) {
        upsertAlert(
          snapshot.botId,
          "LATENCY_HIGH",
          "warning",
          "Average bot response latency is elevated.",
          avgLatencyMs,
        );
      }
    }

    if (prev && now - prev.observedAt <= windowMs) {
      const deltaResponses = Math.max(0, snapshot.responseCount - prev.responseCount);
      const deltaErrors = Math.max(0, snapshot.errorCount - prev.errorCount);
      const totalOutcomes = deltaResponses + deltaErrors;
      if (totalOutcomes >= minSamplesForErrorRate) {
        const errorRate = deltaErrors / totalOutcomes;
        if (errorRate >= errorRateWarn) {
          upsertAlert(
            snapshot.botId,
            "ERROR_RATE_SPIKE",
            errorRate >= 0.5 ? "critical" : "warning",
            "Bot error rate spiked above threshold.",
            errorRate,
          );
        }
      }

      const deltaMessages = Math.max(0, snapshot.messageCount - prev.messageCount);
      const ratePerMinute = deltaMessages / Math.max(1 / 60, (now - prev.observedAt) / 60_000);
      if (ratePerMinute >= 60) {
        upsertAlert(
          snapshot.botId,
          "TRAFFIC_SPIKE",
          "warning",
          "Bot message traffic spike detected.",
          ratePerMinute,
        );
      }
    }
  };

  const listAlerts = (filter?: { botId?: string; maxAgeMs?: number }): BotAlert[] => {
    const now = Date.now();
    const maxAgeMs = Math.max(0, filter?.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000);
    return Array.from(latestAlerts.values())
      .filter((alert) => (!filter?.botId || alert.botId === filter.botId))
      .filter((alert) => now - alert.updatedAt <= maxAgeMs)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  };

  return {
    observe,
    listAlerts,
  };
};

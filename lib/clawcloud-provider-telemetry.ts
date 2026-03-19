type ProviderLogLevel = "info" | "warn" | "error";

type ProviderEventDetails = Record<string, unknown>;

function sanitizeDetails(details: ProviderEventDetails) {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined),
  );
}

export function logClawCloudProviderEvent(
  level: ProviderLogLevel,
  component: string,
  event: string,
  details: ProviderEventDetails = {},
) {
  const payload = {
    ts: new Date().toISOString(),
    component,
    event,
    ...sanitizeDetails(details),
  };

  const line = `[clawcloud-provider] ${JSON.stringify(payload)}`;
  const logger =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;

  logger(line);
}

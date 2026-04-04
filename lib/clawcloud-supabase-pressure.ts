const DEFAULT_PRESSURE_COOLDOWN_MS = 15 * 60 * 1000;

type PressureState = {
  until: number;
  reason: string;
};

const pressureStates = new Map<string, PressureState>();

export function isSupabasePressureMessage(message: string | null | undefined) {
  const normalized = String(message ?? "").trim().toLowerCase();
  return (
    normalized.includes("timed out")
    || normalized.includes("timeout")
    || normalized.includes("connection terminated")
    || normalized.includes("operation has timed out")
    || normalized.includes("the fetch failed")
    || normalized.includes("network error")
    || normalized.includes("522")
    || normalized.includes("bad gateway")
    || normalized.includes("upstream")
    || normalized.includes("unhealthy")
  );
}

export function getSupabasePressureState(scope: string) {
  const state = pressureStates.get(scope);
  if (!state) {
    return null;
  }

  if (state.until <= Date.now()) {
    pressureStates.delete(scope);
    return null;
  }

  return {
    ...state,
    remainingMs: state.until - Date.now(),
  };
}

export function activateSupabasePressureCooldown(
  scope: string,
  reason: string,
  cooldownMs = DEFAULT_PRESSURE_COOLDOWN_MS,
) {
  const until = Date.now() + Math.max(30_000, cooldownMs);
  pressureStates.set(scope, {
    until,
    reason: String(reason || "supabase pressure detected"),
  });

  return {
    until,
    reason,
    remainingMs: until - Date.now(),
  };
}

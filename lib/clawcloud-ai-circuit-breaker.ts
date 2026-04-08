// lib/clawcloud-ai-circuit-breaker.ts
// -----------------------------------------------------------------------------
// MODEL CIRCUIT BREAKER
//
// Prevents cascading failures by tracking consecutive failures per model and
// temporarily skipping models that have failed 2+ times within the cooldown
// window. The circuit automatically resets after the cooldown period expires.
//
// States:
//   CLOSED  — model is healthy, requests flow normally
//   OPEN    — model has failed too many times, requests are skipped
//   HALF    — cooldown expired, next request will probe the model
// -----------------------------------------------------------------------------

type CircuitState = "closed" | "open" | "half";

type CircuitEntry = {
  consecutiveFailures: number;
  lastFailureAt: number;
  openedAt: number | null;
  totalFailures: number;
  totalSuccesses: number;
};

// How many consecutive failures before the circuit opens
const FAILURE_THRESHOLD = 2;

// How long the circuit stays open before allowing a probe (ms)
const COOLDOWN_MS = 60_000;

// Maximum cooldown with exponential backoff (ms)
const MAX_COOLDOWN_MS = 5 * 60_000;

const circuits = new Map<string, CircuitEntry>();

function getEntry(model: string): CircuitEntry {
  const existing = circuits.get(model);
  if (existing) return existing;

  const entry: CircuitEntry = {
    consecutiveFailures: 0,
    lastFailureAt: 0,
    openedAt: null,
    totalFailures: 0,
    totalSuccesses: 0,
  };
  circuits.set(model, entry);
  return entry;
}

function computeCooldownMs(entry: CircuitEntry): number {
  // Exponential backoff: 60s, 120s, 240s, ... capped at MAX_COOLDOWN_MS
  const backoffFactor = Math.max(0, entry.consecutiveFailures - FAILURE_THRESHOLD);
  return Math.min(COOLDOWN_MS * 2 ** backoffFactor, MAX_COOLDOWN_MS);
}

function circuitState(model: string): CircuitState {
  const entry = circuits.get(model);
  if (!entry || entry.consecutiveFailures < FAILURE_THRESHOLD) {
    return "closed";
  }

  const cooldownMs = computeCooldownMs(entry);
  const elapsed = Date.now() - (entry.openedAt ?? entry.lastFailureAt);

  if (elapsed >= cooldownMs) {
    return "half";
  }

  return "open";
}

/**
 * Returns true if the circuit is open and the model should be skipped.
 * Returns false if the circuit is closed or half-open (probe allowed).
 */
export function isModelCircuitOpen(model: string): boolean {
  return circuitState(model) === "open";
}

/**
 * Record a successful response from a model.
 * Resets the consecutive failure counter and closes the circuit.
 */
export function recordCircuitSuccess(model: string): void {
  const entry = getEntry(model);
  entry.consecutiveFailures = 0;
  entry.openedAt = null;
  entry.totalSuccesses += 1;
}

/**
 * Record a failed response from a model.
 * Increments the failure counter and opens the circuit if the threshold is met.
 */
export function recordCircuitFailure(model: string): void {
  const entry = getEntry(model);
  entry.consecutiveFailures += 1;
  entry.lastFailureAt = Date.now();
  entry.totalFailures += 1;

  if (entry.consecutiveFailures >= FAILURE_THRESHOLD && entry.openedAt === null) {
    entry.openedAt = Date.now();
    const cooldownMs = computeCooldownMs(entry);
    console.warn(
      `[circuit-breaker] ${model} circuit OPENED after ${entry.consecutiveFailures} consecutive failures — cooldown ${cooldownMs / 1000}s`,
    );
  }
}

/**
 * Get a snapshot of all circuit states for observability.
 */
export function getCircuitBreakerSnapshot(): Array<{
  model: string;
  state: CircuitState;
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  cooldownRemainingMs: number;
}> {
  const now = Date.now();
  return [...circuits.entries()].map(([model, entry]) => {
    const state = circuitState(model);
    const cooldownMs = computeCooldownMs(entry);
    const elapsed = now - (entry.openedAt ?? entry.lastFailureAt);
    const cooldownRemainingMs = state === "open" ? Math.max(0, cooldownMs - elapsed) : 0;

    return {
      model,
      state,
      consecutiveFailures: entry.consecutiveFailures,
      totalFailures: entry.totalFailures,
      totalSuccesses: entry.totalSuccesses,
      cooldownRemainingMs,
    };
  });
}

/**
 * Reset the circuit for a specific model (for testing or manual recovery).
 */
export function resetCircuit(model: string): void {
  circuits.delete(model);
}

/**
 * Reset all circuits (for testing).
 */
export function resetAllCircuits(): void {
  circuits.clear();
}

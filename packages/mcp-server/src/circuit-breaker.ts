// ── Engine Fallback Manager (Circuit Breaker) ──────────────────────

export type CircuitState = "closed" | "open" | "half_open";

export interface EngineHealth {
  failures: number;
  successes: number;
  consecutiveFailures: number;
  lastFailure: number | undefined;
  state: CircuitState;
  openedAt: number | undefined;
}

const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT_MS = 15_000; // Phase 12: reduced from 60s to 15s for fast recovery
const HALF_OPEN_SUCCESS_THRESHOLD = 1; // Phase 12: single success closes the circuit

const engineHealthMap = new Map<string, EngineHealth>();

function getHealth(engine: string): EngineHealth {
  if (!engineHealthMap.has(engine)) {
    engineHealthMap.set(engine, {
      failures: 0,
      successes: 0,
      consecutiveFailures: 0,
      lastFailure: undefined,
      state: "closed",
      openedAt: undefined,
    });
  }
  return engineHealthMap.get(engine)!;
}

export function shouldSkipEngine(engine: string): boolean {
  const health = getHealth(engine);
  if (health.state === "closed") return false;
  if (health.state === "open") {
    // Check if reset timeout has elapsed → transition to half_open
    if (
      health.openedAt !== undefined &&
      Date.now() - health.openedAt >= RESET_TIMEOUT_MS
    ) {
      health.state = "half_open";
      return false; // Allow a probe request
    }
    return true; // Circuit is open, skip
  }
  // half_open: allow through for probing
  return false;
}

export function recordEngineSuccess(engine: string): void {
  const health = getHealth(engine);
  health.successes++;
  health.consecutiveFailures = 0;

  if (health.state === "half_open") {
    // Need 2 consecutive successes to close
    if (health.successes >= HALF_OPEN_SUCCESS_THRESHOLD) {
      health.state = "closed";
      health.failures = 0;
      health.successes = 0;
      health.openedAt = undefined;
    }
  }
}

export function recordEngineFailure(engine: string): void {
  const health = getHealth(engine);
  health.failures++;
  health.consecutiveFailures++;
  health.lastFailure = Date.now();
  // Reset half_open success count on failure
  if (health.state === "half_open") {
    health.successes = 0;
  }

  if (health.consecutiveFailures >= FAILURE_THRESHOLD) {
    health.state = "open";
    health.openedAt = Date.now();
  }
}

export function getEngineHealth(engine: string): EngineHealth {
  return { ...getHealth(engine) };
}

/** Reset all circuit breaker state (for testing) */
export function resetAllCircuits(): void {
  engineHealthMap.clear();
}

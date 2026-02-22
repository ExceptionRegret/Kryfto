import { sanitizeStepForLogs, type Step } from '@kryfto/shared';

export function buildStepPlan(url: string, steps?: Step[]): Step[] {
  if (steps && steps.length > 0) {
    return steps;
  }

  return [
    { type: 'goto', args: { url } },
    { type: 'waitForNetworkIdle', args: { timeoutMs: 30_000 } },
  ];
}

export function sanitizeStepPlan(steps: Step[]): Step[] {
  return steps.map((step) => sanitizeStepForLogs(step));
}
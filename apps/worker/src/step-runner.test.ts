import { describe, expect, it } from 'vitest';
import { buildStepPlan, sanitizeStepPlan } from './step-runner.js';

describe('step runner helpers', () => {
  it('builds default step plan', () => {
    const plan = buildStepPlan('https://example.com');
    expect(plan[0]?.type).toBe('goto');
    expect(plan[1]?.type).toBe('waitForNetworkIdle');
  });

  it('uses explicit plan when provided', () => {
    const plan = buildStepPlan('https://example.com', [{ type: 'wait', args: { ms: 10 } }]);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.type).toBe('wait');
  });

  it('masks secret values in sanitized plan', () => {
    const result = sanitizeStepPlan([{ type: 'type', args: { selector: '#pwd', text: 'supersecret', secret: true } }]);
    const step = result[0];
    if (!step || step.type !== 'type') {
      throw new Error('expected type step');
    }
    expect(step.args.text).not.toBe('supersecret');
  });
});
import { describe, expect, it } from 'vitest';
import { parseBearerToken, requireRole, roleAllowed } from './auth-rbac.js';

describe('auth/rbac utilities', () => {
  it('parses bearer token', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123');
    expect(parseBearerToken('Basic abc123')).toBeNull();
  });

  it('checks role allowance', () => {
    expect(roleAllowed('admin', ['admin'])).toBe(true);
    expect(roleAllowed('readonly', ['developer'])).toBe(false);
  });

  it('throws for missing auth', () => {
    expect(() => requireRole(undefined, ['admin'])).toThrow('AUTH_UNAUTHORIZED');
  });

  it('throws for forbidden role', () => {
    expect(() => requireRole({ tokenId: 't', projectId: 'p', role: 'readonly', tokenHash: 'h' }, ['developer'])).toThrow(
      'AUTH_FORBIDDEN'
    );
  });
});
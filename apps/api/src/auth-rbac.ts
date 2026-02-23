import type { AuthContext } from "@kryfto/shared";

export function parseBearerToken(input: string | undefined): string | null {
  if (!input) return null;
  if (!input.startsWith("Bearer ")) return null;
  const token = input.slice("Bearer ".length).trim();
  return token || null;
}

export function roleAllowed(
  role: AuthContext["role"],
  allowedRoles: Array<AuthContext["role"]>
): boolean {
  return allowedRoles.includes(role);
}

export function requireRole(
  auth: AuthContext | undefined,
  allowedRoles: Array<AuthContext["role"]>
): AuthContext {
  if (!auth) {
    throw new Error("AUTH_UNAUTHORIZED");
  }

  if (!roleAllowed(auth.role, allowedRoles)) {
    throw new Error("AUTH_FORBIDDEN");
  }

  return auth;
}

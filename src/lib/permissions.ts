export type SessionUserLike = {
  id: string;
  role?: string;
  organizationId?: string | null;
};

export function isAdminLike(role?: string | null): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export function resolveOrganizationIdForStaff(
  user: Pick<SessionUserLike, "role" | "organizationId">,
  requestedOrgId?: string | null
): string | null {
  if (user.role === "ADMIN") return user.organizationId || null;
  if (user.role === "SUPER_ADMIN") return requestedOrgId || user.organizationId || null;
  return null;
}
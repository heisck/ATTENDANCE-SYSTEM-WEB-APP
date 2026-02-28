"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Ban, Loader2, RefreshCcw, Send, ShieldPlus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { AttendanceTable } from "@/components/dashboard/attendance-table";

type Invite = {
  id: string;
  invitedEmail: string;
  targetUserId: string | null;
  cohortId: string | null;
  courseId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  cohort?: { displayName: string } | null;
  course?: { code: string; name: string } | null;
};

type Scope = {
  id: string;
  userId: string;
  active: boolean;
  createdAt: string;
  user?: { id: string; name: string; email: string } | null;
  cohort?: { id: string; displayName: string } | null;
  course?: { id: string; code: string; name: string } | null;
};

export default function AdminCourseRepsPage() {
  const { data: session } = useSession();
  const [organizationIdInput, setOrganizationIdInput] = useState("");

  const [invitedEmail, setInvitedEmail] = useState("");
  const [inviteTtlHours, setInviteTtlHours] = useState(72);
  const [inviteCohortId, setInviteCohortId] = useState("");
  const [inviteCourseId, setInviteCourseId] = useState("");
  const [inviteTargetUserId, setInviteTargetUserId] = useState("");

  const [assignUserId, setAssignUserId] = useState("");
  const [assignEmail, setAssignEmail] = useState("");
  const [assignCohortId, setAssignCohortId] = useState("");
  const [assignCourseId, setAssignCourseId] = useState("");
  const [assignActive, setAssignActive] = useState(true);

  const [loading, setLoading] = useState(true);
  const [submittingInvite, setSubmittingInvite] = useState(false);
  const [submittingAssign, setSubmittingAssign] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);

  const role = (session?.user as any)?.role as string | undefined;
  const sessionOrgId = (session?.user as any)?.organizationId as string | undefined;
  const organizationId = useMemo(
    () => (role === "SUPER_ADMIN" ? organizationIdInput.trim() : sessionOrgId || ""),
    [organizationIdInput, role, sessionOrgId]
  );

  useEffect(() => {
    if (!session?.user) return;
    if (role === "SUPER_ADMIN" && !organizationId) {
      setInvites([]);
      setScopes([]);
      setLoading(false);
      return;
    }
    void loadData();
  }, [session, role, organizationId]);

  async function loadData() {
    setLoading(true);
    try {
      const query = role === "SUPER_ADMIN" ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
      const [inviteRes, scopeRes] = await Promise.all([
        fetch(`/api/admin/course-rep-invites${query}`, { cache: "no-store" }),
        fetch(`/api/admin/course-rep-assign${query}`, { cache: "no-store" }),
      ]);

      const inviteData = await inviteRes.json();
      if (!inviteRes.ok) throw new Error(inviteData.error || "Unable to load invites");
      setInvites(inviteData.invites || []);

      const scopeData = await scopeRes.json();
      if (!scopeRes.ok) throw new Error(scopeData.error || "Unable to load scopes");
      setScopes(scopeData.scopes || []);
    } catch (error: any) {
      toast.error(error?.message || "Unable to load course rep data");
    } finally {
      setLoading(false);
    }
  }

  async function handleInviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingInvite(true);
    try {
      const payload: Record<string, unknown> = {
        invitedEmail,
        ttlHours: inviteTtlHours,
        cohortId: inviteCohortId || undefined,
        courseId: inviteCourseId || undefined,
        targetUserId: inviteTargetUserId || undefined,
      };
      if (role === "SUPER_ADMIN") payload.organizationId = organizationId;

      const response = await fetch("/api/admin/course-rep-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create invite");

      toast.success("Course Rep invite sent");
      setInvitedEmail("");
      setInviteTargetUserId("");
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to create invite");
    } finally {
      setSubmittingInvite(false);
    }
  }

  async function handleAssignSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingAssign(true);
    try {
      const payload: Record<string, unknown> = {
        userId: assignUserId || undefined,
        email: assignEmail || undefined,
        cohortId: assignCohortId || undefined,
        courseId: assignCourseId || undefined,
        active: assignActive,
      };
      if (role === "SUPER_ADMIN") payload.organizationId = organizationId;

      const response = await fetch("/api/admin/course-rep-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to assign course rep scope");

      toast.success(assignActive ? "Scope assigned" : "Scope deactivated");
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to assign scope");
    } finally {
      setSubmittingAssign(false);
    }
  }

  async function runInviteAction(id: string, action: "resend" | "revoke") {
    try {
      const payload: Record<string, unknown> = { action };
      if (role === "SUPER_ADMIN") payload.organizationId = organizationId;

      const response = await fetch(`/api/admin/course-rep-invites/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Failed to ${action} invite`);

      toast.success(`Invite ${action} completed`);
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || `Failed to ${action} invite`);
    }
  }

  async function deactivateScope(scope: Scope) {
    try {
      const payload: Record<string, unknown> = {
        userId: scope.userId,
        cohortId: scope.cohort?.id || undefined,
        courseId: scope.course?.id || undefined,
        active: false,
      };
      if (role === "SUPER_ADMIN") payload.organizationId = organizationId;

      const response = await fetch("/api/admin/course-rep-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to deactivate scope");
      toast.success("Scope deactivated");
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to deactivate scope");
    }
  }

  if (!session?.user) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Course Rep Management"
        description="Invite, assign, and moderate Course Rep scoped permissions."
      />

      {role === "SUPER_ADMIN" ? (
        <div className="surface space-y-2 p-4">
          <label htmlFor="organizationId" className="text-sm font-medium">
            Organization ID
          </label>
          <input
            id="organizationId"
            value={organizationIdInput}
            onChange={(event) => setOrganizationIdInput(event.target.value)}
            placeholder="Required for super-admin"
            className="h-10 w-full rounded-md border border-input bg-background px-3"
          />
        </div>
      ) : null}

      <form onSubmit={handleInviteSubmit} className="surface grid gap-4 p-4 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Invited Email
          </label>
          <input
            type="email"
            value={invitedEmail}
            required
            onChange={(event) => setInvitedEmail(event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3"
            placeholder="student@institution.edu"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            TTL Hours
          </label>
          <input
            type="number"
            min={1}
            max={168}
            value={inviteTtlHours}
            onChange={(event) => setInviteTtlHours(Number(event.target.value))}
            className="h-10 w-full rounded-md border border-input bg-background px-3"
          />
        </div>
        <Field
          label="Cohort ID"
          value={inviteCohortId}
          onChange={setInviteCohortId}
          placeholder="Optional"
        />
        <Field
          label="Course ID"
          value={inviteCourseId}
          onChange={setInviteCourseId}
          placeholder="Optional"
        />
        <Field
          label="Target User ID"
          value={inviteTargetUserId}
          onChange={setInviteTargetUserId}
          placeholder="Optional existing user"
        />
        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={submittingInvite || (role === "SUPER_ADMIN" && !organizationId)}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {submittingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send Course Rep Invite
          </button>
        </div>
      </form>

      <form onSubmit={handleAssignSubmit} className="surface grid gap-4 p-4 sm:grid-cols-3">
        <Field
          label="User ID"
          value={assignUserId}
          onChange={setAssignUserId}
          placeholder="Existing student user ID"
        />
        <Field
          label="or Student Email"
          value={assignEmail}
          onChange={setAssignEmail}
          placeholder="student@institution.edu"
        />
        <label className="space-y-1 text-sm">
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Active</span>
          <select
            value={assignActive ? "true" : "false"}
            onChange={(event) => setAssignActive(event.target.value === "true")}
            className="h-10 w-full rounded-md border border-input bg-background px-3"
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
        <Field
          label="Cohort ID"
          value={assignCohortId}
          onChange={setAssignCohortId}
          placeholder="Optional"
        />
        <Field
          label="Course ID"
          value={assignCourseId}
          onChange={setAssignCourseId}
          placeholder="Optional"
        />
        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={submittingAssign || (role === "SUPER_ADMIN" && !organizationId)}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {submittingAssign ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldPlus className="h-4 w-4" />
            )}
            Apply Scope Assignment
          </button>
        </div>
      </form>

      <AttendanceTable
        columns={[
          { key: "email", label: "Invited Email" },
          { key: "scope", label: "Scope" },
          { key: "status", label: "Status" },
          { key: "expires", label: "Expires" },
          { key: "actions", label: "Actions" },
        ]}
        data={invites.map((invite) => {
          const status = invite.acceptedAt
            ? "Accepted"
            : invite.revokedAt
              ? "Revoked"
              : new Date(invite.expiresAt) < new Date()
                ? "Expired"
                : "Pending";
          return {
            email: invite.invitedEmail,
            scope: invite.course
              ? `${invite.course.code} - ${invite.course.name}`
              : invite.cohort?.displayName || "Manual Scope",
            status,
            expires: new Date(invite.expiresAt).toLocaleString(),
            actions: (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runInviteAction(invite.id, "resend")}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                >
                  <RefreshCcw className="h-3 w-3" />
                  Resend
                </button>
                <button
                  type="button"
                  onClick={() => void runInviteAction(invite.id, "revoke")}
                  className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive"
                >
                  <Ban className="h-3 w-3" />
                  Revoke
                </button>
              </div>
            ),
          };
        })}
        emptyMessage={loading ? "Loading invites..." : "No course rep invites yet."}
      />

      <AttendanceTable
        columns={[
          { key: "rep", label: "Course Rep" },
          { key: "scope", label: "Scope" },
          { key: "active", label: "Active" },
          { key: "assignedAt", label: "Assigned" },
          { key: "actions", label: "Actions" },
        ]}
        data={scopes.map((scope) => ({
          rep: scope.user ? `${scope.user.name} (${scope.user.email})` : scope.userId,
          scope: scope.course
            ? `${scope.course.code} - ${scope.course.name}`
            : scope.cohort?.displayName || "Unscoped",
          active: scope.active ? "Yes" : "No",
          assignedAt: new Date(scope.createdAt).toLocaleString(),
          actions: scope.active ? (
            <button
              type="button"
              onClick={() => void deactivateScope(scope)}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive"
            >
              <Ban className="h-3 w-3" />
              Deactivate
            </button>
          ) : (
            "-"
          ),
        }))}
        emptyMessage={loading ? "Loading scopes..." : "No course rep scopes yet."}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-md border border-input bg-background px-3"
      />
    </label>
  );
}


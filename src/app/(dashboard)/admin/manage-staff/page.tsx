"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Ban, Loader2, RefreshCcw, Send, ShieldPlus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { OverviewMetrics } from "@/components/dashboard/overview-metrics";
import { AttendanceTable } from "@/components/dashboard/attendance-table";

type LecturerRecord = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  courses: Array<{
    id: string;
    code: string;
    name: string;
  }>;
};

type LecturerInvite = {
  id: string;
  invitedEmail: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type CourseRepInvite = {
  id: string;
  invitedEmail: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  course?: { code: string; name: string } | null;
  cohort?: { displayName: string } | null;
};

type CourseRepScope = {
  id: string;
  userId: string;
  active: boolean;
  createdAt: string;
  user?: { name: string; email: string } | null;
  course?: { id: string; code: string; name: string } | null;
  cohort?: { id: string; displayName: string } | null;
};

function inviteStatus(invite: { acceptedAt: string | null; revokedAt: string | null; expiresAt: string }) {
  if (invite.acceptedAt) return "Accepted";
  if (invite.revokedAt) return "Revoked";
  if (new Date(invite.expiresAt) < new Date()) return "Expired";
  return "Pending";
}

export default function AdminManageStaffPage() {
  const { data: session } = useSession();
  const [organizationIdInput, setOrganizationIdInput] = useState("");

  const [lecturers, setLecturers] = useState<LecturerRecord[]>([]);
  const [lecturerInvites, setLecturerInvites] = useState<LecturerInvite[]>([]);
  const [courseRepInvites, setCourseRepInvites] = useState<CourseRepInvite[]>([]);
  const [courseRepScopes, setCourseRepScopes] = useState<CourseRepScope[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [lecturerEmail, setLecturerEmail] = useState("");
  const [lecturerTtlHours, setLecturerTtlHours] = useState(72);
  const [sendingLecturerInvite, setSendingLecturerInvite] = useState(false);

  const [assignStudentEmail, setAssignStudentEmail] = useState("");
  const [assignStudentUserId, setAssignStudentUserId] = useState("");
  const [assignClassGroupId, setAssignClassGroupId] = useState("");
  const [assignCourseId, setAssignCourseId] = useState("");
  const [assignScopeActive, setAssignScopeActive] = useState(true);
  const [assigningCourseRep, setAssigningCourseRep] = useState(false);

  const [courseRepInviteEmail, setCourseRepInviteEmail] = useState("");
  const [courseRepInviteTtl, setCourseRepInviteTtl] = useState(72);
  const [courseRepInviteClassGroupId, setCourseRepInviteClassGroupId] = useState("");
  const [courseRepInviteCourseId, setCourseRepInviteCourseId] = useState("");
  const [courseRepInviteTargetUserId, setCourseRepInviteTargetUserId] = useState("");
  const [sendingCourseRepInvite, setSendingCourseRepInvite] = useState(false);

  const role = (session?.user as any)?.role as string | undefined;
  const sessionOrgId = (session?.user as any)?.organizationId as string | undefined;
  const organizationId = useMemo(
    () => (role === "SUPER_ADMIN" ? organizationIdInput.trim() : sessionOrgId || ""),
    [organizationIdInput, role, sessionOrgId],
  );

  const querySuffix = useMemo(
    () => (role === "SUPER_ADMIN" && organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ""),
    [organizationId, role],
  );

  const canSubmitForOrg = role !== "SUPER_ADMIN" || organizationId.length > 0;

  async function loadAll() {
    if (!session?.user) return;
    if (role === "SUPER_ADMIN" && !organizationId) {
      setLecturers([]);
      setLecturerInvites([]);
      setCourseRepInvites([]);
      setCourseRepScopes([]);
      setLoadingData(false);
      return;
    }

    setLoadingData(true);
    try {
      const [lecturerRes, lecturerInviteRes, repInviteRes, repScopeRes] = await Promise.all([
        fetch(`/api/admin/lecturers${querySuffix}`, { cache: "no-store" }),
        fetch(`/api/admin/lecturer-invites${querySuffix}`, { cache: "no-store" }),
        fetch(`/api/admin/course-rep-invites${querySuffix}`, { cache: "no-store" }),
        fetch(`/api/admin/course-rep-assign${querySuffix}`, { cache: "no-store" }),
      ]);

      const [lecturerData, lecturerInviteData, repInviteData, repScopeData] = await Promise.all([
        lecturerRes.json(),
        lecturerInviteRes.json(),
        repInviteRes.json(),
        repScopeRes.json(),
      ]);

      if (!lecturerRes.ok) throw new Error(lecturerData.error || "Failed to load lecturers");
      if (!lecturerInviteRes.ok) throw new Error(lecturerInviteData.error || "Failed to load lecturer invites");
      if (!repInviteRes.ok) throw new Error(repInviteData.error || "Failed to load course rep invites");
      if (!repScopeRes.ok) throw new Error(repScopeData.error || "Failed to load course reps");

      setLecturers(Array.isArray(lecturerData.lecturers) ? lecturerData.lecturers : []);
      setLecturerInvites(Array.isArray(lecturerInviteData.invites) ? lecturerInviteData.invites : []);
      setCourseRepInvites(Array.isArray(repInviteData.invites) ? repInviteData.invites : []);
      setCourseRepScopes(Array.isArray(repScopeData.scopes) ? repScopeData.scopes : []);
    } catch (error: any) {
      toast.error(error?.message || "Failed to load staff management data");
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, [organizationId, role, session?.user, querySuffix]);

  function withOrg(payload: Record<string, unknown>) {
    if (role === "SUPER_ADMIN") {
      return { ...payload, organizationId };
    }
    return payload;
  }

  async function handleSendLecturerInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitForOrg) return;

    setSendingLecturerInvite(true);
    try {
      const response = await fetch("/api/admin/lecturer-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withOrg({ invitedEmail: lecturerEmail, ttlHours: lecturerTtlHours })),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to send lecturer invite");

      toast.success("Lecturer invite sent");
      setLecturerEmail("");
      await loadAll();
    } catch (error: any) {
      toast.error(error?.message || "Failed to send lecturer invite");
    } finally {
      setSendingLecturerInvite(false);
    }
  }

  async function runLecturerInviteAction(id: string, action: "resend" | "revoke") {
    try {
      const response = await fetch(`/api/admin/lecturer-invites/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withOrg({ action })),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Failed to ${action} lecturer invite`);
      toast.success(`Lecturer invite ${action} completed`);
      await loadAll();
    } catch (error: any) {
      toast.error(error?.message || `Failed to ${action} lecturer invite`);
    }
  }

  async function handleAssignCourseRep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitForOrg) return;

    setAssigningCourseRep(true);
    try {
      const response = await fetch("/api/admin/course-rep-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          withOrg({
            email: assignStudentEmail || undefined,
            userId: assignStudentUserId || undefined,
            cohortId: assignClassGroupId || undefined,
            courseId: assignCourseId || undefined,
            active: assignScopeActive,
          }),
        ),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to assign course rep");

      toast.success(assignScopeActive ? "Course rep privileges applied" : "Course rep privileges removed");
      setAssignStudentEmail("");
      setAssignStudentUserId("");
      await loadAll();
    } catch (error: any) {
      toast.error(error?.message || "Failed to assign course rep");
    } finally {
      setAssigningCourseRep(false);
    }
  }

  async function handleSendCourseRepInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitForOrg) return;

    setSendingCourseRepInvite(true);
    try {
      const response = await fetch("/api/admin/course-rep-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          withOrg({
            invitedEmail: courseRepInviteEmail,
            ttlHours: courseRepInviteTtl,
            cohortId: courseRepInviteClassGroupId || undefined,
            courseId: courseRepInviteCourseId || undefined,
            targetUserId: courseRepInviteTargetUserId || undefined,
          }),
        ),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to send course rep invite");

      toast.success("Course rep invite sent");
      setCourseRepInviteEmail("");
      setCourseRepInviteTargetUserId("");
      await loadAll();
    } catch (error: any) {
      toast.error(error?.message || "Failed to send course rep invite");
    } finally {
      setSendingCourseRepInvite(false);
    }
  }

  async function runCourseRepInviteAction(id: string, action: "resend" | "revoke") {
    try {
      const response = await fetch(`/api/admin/course-rep-invites/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withOrg({ action })),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Failed to ${action} course rep invite`);

      toast.success(`Course rep invite ${action} completed`);
      await loadAll();
    } catch (error: any) {
      toast.error(error?.message || `Failed to ${action} course rep invite`);
    }
  }

  const pendingLecturerInvites = lecturerInvites.filter((invite) => inviteStatus(invite) === "Pending").length;
  const pendingCourseRepInvites = courseRepInvites.filter((invite) => inviteStatus(invite) === "Pending").length;
  const activeCourseRepUsers = new Set(
    courseRepScopes.filter((scope) => scope.active).map((scope) => scope.userId),
  ).size;

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Invite lecturers, assign course rep privileges, and review who is active.
        </p>
      </section>

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

      <OverviewMetrics
        title="Staff Snapshot"
        compact
        items={[
          { key: "lecturers", label: "Lecturers", value: lecturers.length },
          { key: "courseReps", label: "Active Course Reps", value: activeCourseRepUsers },
          { key: "lecturerInvites", label: "Pending Lecturer Invites", value: pendingLecturerInvites },
          { key: "repInvites", label: "Pending Course Rep Invites", value: pendingCourseRepInvites },
        ]}
      />

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">Lecturers</h2>
        <AttendanceTable
          columns={[
            { key: "name", label: "Lecturer" },
            { key: "email", label: "Institution Email" },
            { key: "courses", label: "Courses Taught" },
            { key: "joined", label: "Joined" },
            { key: "manage", label: "" },
          ]}
          data={lecturers.map((lecturer) => ({
            name: lecturer.name,
            email: lecturer.email,
            courses:
              lecturer.courses.length > 0
                ? lecturer.courses.map((course) => `${course.code}`).join(", ")
                : "No courses assigned",
            joined: new Date(lecturer.createdAt).toLocaleDateString(),
            manage: (
              <Link href="/admin/courses" className="text-primary text-sm font-medium hover:underline">
                Manage Courses
              </Link>
            ),
          }))}
          emptyMessage={loadingData ? "Loading lecturers..." : "No lecturers found yet."}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold tracking-tight">Lecturer Invitations</h2>

        <form onSubmit={handleSendLecturerInvite} className="surface grid gap-4 p-4 sm:grid-cols-3">
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Lecturer Institutional Email
            </span>
            <input
              type="email"
              required
              value={lecturerEmail}
              onChange={(event) => setLecturerEmail(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
              placeholder="lecturer@institution.edu"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">TTL Hours</span>
            <input
              type="number"
              min={1}
              max={168}
              value={lecturerTtlHours}
              onChange={(event) => setLecturerTtlHours(Number(event.target.value))}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
            />
          </label>

          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={sendingLecturerInvite || !canSubmitForOrg}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {sendingLecturerInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send Lecturer Invite
            </button>
          </div>
        </form>

        <AttendanceTable
          columns={[
            { key: "email", label: "Invited Email" },
            { key: "status", label: "Status" },
            { key: "expires", label: "Expires" },
            { key: "actions", label: "Actions" },
          ]}
          data={lecturerInvites.map((invite) => ({
            email: invite.invitedEmail,
            status: inviteStatus(invite),
            expires: new Date(invite.expiresAt).toLocaleString(),
            actions: (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runLecturerInviteAction(invite.id, "resend")}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                >
                  <RefreshCcw className="h-3 w-3" />
                  Resend
                </button>
                <button
                  type="button"
                  onClick={() => void runLecturerInviteAction(invite.id, "revoke")}
                  className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive"
                >
                  <Ban className="h-3 w-3" />
                  Revoke
                </button>
              </div>
            ),
          }))}
          emptyMessage={loadingData ? "Loading lecturer invites..." : "No lecturer invites yet."}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold tracking-tight">Course Reps</h2>

        <form onSubmit={handleAssignCourseRep} className="surface grid gap-4 p-4 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Student Institutional Email
            </span>
            <input
              value={assignStudentEmail}
              onChange={(event) => setAssignStudentEmail(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
              placeholder="student@institution.edu"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">or User ID</span>
            <input
              value={assignStudentUserId}
              onChange={(event) => setAssignStudentUserId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
              placeholder="Optional"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Active</span>
            <select
              value={assignScopeActive ? "true" : "false"}
              onChange={(event) => setAssignScopeActive(event.target.value === "true")}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
            >
              <option value="true">Enable</option>
              <option value="false">Disable</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Class Group ID
            </span>
            <input
              value={assignClassGroupId}
              onChange={(event) => setAssignClassGroupId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
              placeholder="Optional"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Course ID</span>
            <input
              value={assignCourseId}
              onChange={(event) => setAssignCourseId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
              placeholder="Optional"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={assigningCourseRep || !canSubmitForOrg}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {assigningCourseRep ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldPlus className="h-4 w-4" />}
              Apply Course Rep Privileges
            </button>
          </div>
        </form>

        <AttendanceTable
          columns={[
            { key: "rep", label: "Course Rep" },
            { key: "scope", label: "Scope" },
            { key: "active", label: "Status" },
            { key: "assigned", label: "Assigned" },
          ]}
          data={courseRepScopes.map((scope) => ({
            rep: scope.user ? `${scope.user.name} (${scope.user.email})` : scope.userId,
            scope: scope.course
              ? `${scope.course.code} - ${scope.course.name}`
              : scope.cohort?.displayName || "General",
            active: scope.active ? "Enabled" : "Disabled",
            assigned: new Date(scope.createdAt).toLocaleString(),
          }))}
          emptyMessage={loadingData ? "Loading course reps..." : "No course reps assigned yet."}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold tracking-tight">Course Rep Invitations</h2>

        <form onSubmit={handleSendCourseRepInvite} className="surface grid gap-4 p-4 sm:grid-cols-3">
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Student Institutional Email
            </span>
            <input
              type="email"
              required
              value={courseRepInviteEmail}
              onChange={(event) => setCourseRepInviteEmail(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
              placeholder="student@institution.edu"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">TTL Hours</span>
            <input
              type="number"
              min={1}
              max={168}
              value={courseRepInviteTtl}
              onChange={(event) => setCourseRepInviteTtl(Number(event.target.value))}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Class Group ID
            </span>
            <input
              value={courseRepInviteClassGroupId}
              onChange={(event) => setCourseRepInviteClassGroupId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
              placeholder="Optional"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Course ID</span>
            <input
              value={courseRepInviteCourseId}
              onChange={(event) => setCourseRepInviteCourseId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
              placeholder="Optional"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Target User ID
            </span>
            <input
              value={courseRepInviteTargetUserId}
              onChange={(event) => setCourseRepInviteTargetUserId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
              placeholder="Optional existing student user ID"
            />
          </label>

          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={sendingCourseRepInvite || !canSubmitForOrg}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {sendingCourseRepInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Send Course Rep Invite
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
          data={courseRepInvites.map((invite) => ({
            email: invite.invitedEmail,
            scope: invite.course
              ? `${invite.course.code} - ${invite.course.name}`
              : invite.cohort?.displayName || "General",
            status: inviteStatus(invite),
            expires: new Date(invite.expiresAt).toLocaleString(),
            actions: (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runCourseRepInviteAction(invite.id, "resend")}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                >
                  <RefreshCcw className="h-3 w-3" />
                  Resend
                </button>
                <button
                  type="button"
                  onClick={() => void runCourseRepInviteAction(invite.id, "revoke")}
                  className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive"
                >
                  <Ban className="h-3 w-3" />
                  Revoke
                </button>
              </div>
            ),
          }))}
          emptyMessage={loadingData ? "Loading course rep invites..." : "No course rep invites yet."}
        />
      </section>
    </div>
  );
}

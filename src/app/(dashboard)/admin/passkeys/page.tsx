"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Lock, Trash2, Unlock } from "lucide-react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";

interface PasskeyUser {
  id: string;
  email: string;
  name: string;
  role: string;
  studentId: string | null;
  indexNumber: string | null;
  joinedAt: string;
  passkeysLockedUntilAdminReset: boolean;
  firstPasskeyCreatedAt: string | null;
  credentialCount: number;
  attendanceCount: number;
  deviceRegistered: boolean;
  classGroup: {
    id: string;
    displayName: string;
    level: number;
  } | null;
}

export default function PasskeyManagementPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<PasskeyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  if (!session?.user) {
    redirect("/login");
  }

  const userRole = (session.user as any).role;
  if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
    redirect("/");
  }

  useEffect(() => {
    void fetchUsers();
  }, []);

  async function fetchUsers() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/passkeys");
      if (!res.ok) throw new Error("Failed to fetch users");
      const data = await res.json();
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch users");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlockPasskeys(userId: string) {
    try {
      setActionInProgress(true);
      const res = await fetch(`/api/admin/passkeys/${userId}/unlock`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to unlock passkeys");
      }

      toast.success(`Passkeys unlocked for ${users.find((u) => u.id === userId)?.name}`);
      await fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Failed to unlock passkeys");
    } finally {
      setActionInProgress(false);
    }
  }

  async function handleLockPasskeys(userId: string) {
    try {
      setActionInProgress(true);
      const res = await fetch(`/api/admin/passkeys/${userId}/lock`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to lock passkeys");
      }

      toast.success(`Passkeys locked for ${users.find((u) => u.id === userId)?.name}`);
      await fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Failed to lock passkeys");
    } finally {
      setActionInProgress(false);
    }
  }

  async function handleDeleteCredentials(userId: string) {
    if (!confirm("Delete all passkeys for this user? They will need to re-register.")) {
      return;
    }

    try {
      setActionInProgress(true);
      const res = await fetch(`/api/admin/passkeys/${userId}/delete`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete credentials");
      }

      toast.success(`Passkeys deleted for ${users.find((u) => u.id === userId)?.name}`);
      await fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete credentials");
    } finally {
      setActionInProgress(false);
    }
  }

  const classOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of users) {
      if (user.classGroup) {
        map.set(user.classGroup.id, user.classGroup.displayName);
      }
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [users]);

  const levelOptions = useMemo(() => {
    const uniqueLevels = Array.from(
      new Set(users.map((user) => user.classGroup?.level).filter((level): level is number => typeof level === "number"))
    );
    return uniqueLevels.sort((a, b) => a - b);
  }, [users]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return users.filter((user) => {
      if (classFilter !== "all" && user.classGroup?.id !== classFilter) return false;
      if (levelFilter !== "all" && String(user.classGroup?.level ?? "") !== levelFilter) return false;
      if (statusFilter === "locked" && !user.passkeysLockedUntilAdminReset) return false;
      if (statusFilter === "active" && user.passkeysLockedUntilAdminReset) return false;

      if (!normalizedQuery) return true;

      const searchFields = [
        user.name,
        user.email,
        user.role,
        user.studentId || "",
        user.indexNumber || "",
        user.classGroup?.displayName || "",
        user.passkeysLockedUntilAdminReset ? "locked" : "active",
      ]
        .join(" ")
        .toLowerCase();

      return searchFields.includes(normalizedQuery);
    });
  }, [classFilter, levelFilter, query, statusFilter, users]);

  return (
    <div className="space-y-6">
      <PageHeader description="Search users, manage passkeys, and review user access details in one place." />

      <section className="surface grid gap-3 p-4 md:grid-cols-4">
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Search</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email, role, status, index or student ID..."
            className="h-10 w-full rounded-md border border-input bg-background px-3"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Class Group</span>
          <select
            value={classFilter}
            onChange={(event) => setClassFilter(event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3"
          >
            <option value="all">All class groups</option>
            {classOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Level</span>
            <select
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
            >
              <option value="all">All levels</option>
              {levelOptions.map((level) => (
                <option key={level} value={String(level)}>
                  {level}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="locked">Locked</option>
            </select>
          </label>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">User</th>
                  <th className="px-4 py-3 text-left font-medium">Institution Email</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-left font-medium">Student ID / Index</th>
                  <th className="px-4 py-3 text-left font-medium">Class Group</th>
                  <th className="px-4 py-3 text-left font-medium">Device</th>
                  <th className="px-4 py-3 text-left font-medium">Attendance</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Passkeys</th>
                  <th className="px-4 py-3 text-left font-medium">Joined</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{user.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                    <td className="px-4 py-3">{user.role}</td>
                    <td className="px-4 py-3">{user.studentId || user.indexNumber || "-"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{user.classGroup?.displayName || "-"}</td>
                    <td className="px-4 py-3">{user.deviceRegistered ? "Registered" : "No"}</td>
                    <td className="px-4 py-3">{user.attendanceCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {user.passkeysLockedUntilAdminReset ? (
                          <>
                            <Lock className="h-4 w-4 text-destructive" />
                            <span className="text-xs font-medium text-destructive">Locked</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-foreground" />
                            <span className="text-xs font-medium text-foreground">Active</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                        {user.credentialCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(user.joinedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {user.passkeysLockedUntilAdminReset ? (
                          <button
                            onClick={() => void handleUnlockPasskeys(user.id)}
                            disabled={actionInProgress}
                            title="Allow user to create new passkey"
                            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                          >
                            {actionInProgress ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlock className="h-3 w-3" />}
                            Unlock
                          </button>
                        ) : (
                          <button
                            onClick={() => void handleLockPasskeys(user.id)}
                            disabled={actionInProgress}
                            title="Lock passkey changes until admin unlocks"
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80 disabled:opacity-50"
                          >
                            {actionInProgress ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                            Lock
                          </button>
                        )}
                        <button
                          onClick={() => void handleDeleteCredentials(user.id)}
                          disabled={actionInProgress}
                          title="Delete all passkeys for this user"
                          className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
                        >
                          {actionInProgress ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredUsers.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-muted-foreground">No users found for the current filters.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

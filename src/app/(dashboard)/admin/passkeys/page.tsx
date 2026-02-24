"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, Lock, Unlock, Loader2, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { toast } from "sonner";

interface PasskeyUser {
  id: string;
  email: string;
  name: string;
  role: string;
  passkeysLockedUntilAdminReset: boolean;
  firstPasskeyCreatedAt: string | null;
  credentialCount: number;
}

export default function PasskeyManagementPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<PasskeyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(false);

  if (!session?.user) {
    redirect("/login");
  }

  const userRole = (session.user as any).role;
  if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
    redirect("/");
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/passkeys");
      if (!res.ok) throw new Error("Failed to fetch users");
      const data = await res.json();
      setUsers(data.users);
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

      toast.success(`Passkeys unlocked for ${users.find(u => u.id === userId)?.name}`);
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

      toast.success(`Passkeys deleted for ${users.find(u => u.id === userId)?.name}`);
      await fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete credentials");
    } finally {
      setActionInProgress(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="surface p-6">
        <h1 className="text-2xl font-bold tracking-tight">Passkey Management</h1>
        <p className="mt-2 text-muted-foreground">
          Manage user passkeys and control lock state for legitimate access recovery
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">User</th>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Passkeys</th>
                  <th className="px-4 py-3 text-left font-medium">Created</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{user.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {user.passkeysLockedUntilAdminReset ? (
                          <>
                            <Lock className="h-4 w-4 text-destructive" />
                            <span className="text-xs font-medium text-destructive">
                              Locked
                            </span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-foreground" />
                            <span className="text-xs font-medium text-foreground">
                              Active
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                        {user.credentialCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {user.firstPasskeyCreatedAt
                        ? new Date(user.firstPasskeyCreatedAt).toLocaleDateString()
                        : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {user.passkeysLockedUntilAdminReset ? (
                          <button
                            onClick={() => handleUnlockPasskeys(user.id)}
                            disabled={actionInProgress}
                            title="Allow user to create new passkey"
                            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
                          >
                            {actionInProgress ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Unlock className="h-3 w-3" />
                            )}
                            Unlock
                          </button>
                        ) : (
                          <button
                            onClick={() => handleLockPasskeys(user.id)}
                            disabled={actionInProgress}
                            title="Lock passkey changes until admin unlocks"
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80 disabled:opacity-50 transition-colors"
                          >
                            {actionInProgress ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Lock className="h-3 w-3" />
                            )}
                            Lock
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteCredentials(user.id)}
                          disabled={actionInProgress}
                          title="Delete all passkeys for this user"
                          className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50 transition-colors"
                        >
                          {actionInProgress ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {users.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-muted-foreground">No users found</p>
            </div>
          )}
        </div>
      )}

      <div className="surface-muted space-y-3 p-4">
        <h3 className="font-semibold">How this works</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <span className="font-medium text-foreground">Locked:</span>
            <span>User cannot create new passkeys. Prevents unauthorized device registration.</span>
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-foreground">Unlock:</span>
            <span>Allow user to register a new passkey on a different device (e.g., lost device).</span>
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-foreground">Lock:</span>
            <span>Disable passkey delete/add actions again until an admin re-unlocks the user.</span>
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-foreground">Delete:</span>
            <span>Remove all passkeys and unlock account for fresh re-registration.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Loader2, Mail, Send, RefreshCcw, Ban } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";

type LecturerInvite = {
  id: string;
  organizationId: string;
  invitedEmail: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export default function LecturerInvitesPage() {
  const { data: session } = useSession();
  const [organizationIdInput, setOrganizationIdInput] = useState("");
  const [invitedEmail, setInvitedEmail] = useState("");
  const [ttlHours, setTtlHours] = useState(72);
  const [invites, setInvites] = useState<LecturerInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const role = (session?.user as any)?.role as string | undefined;
  const sessionOrgId = (session?.user as any)?.organizationId as string | undefined;
  const organizationId = useMemo(
    () => (role === "SUPER_ADMIN" ? organizationIdInput.trim() : sessionOrgId || ""),
    [organizationIdInput, role, sessionOrgId]
  );

  useEffect(() => {
    if (!session?.user) return;
    if (!organizationId && role === "SUPER_ADMIN") {
      setInvites([]);
      setLoading(false);
      return;
    }
    void fetchInvites();
  }, [session, organizationId, role]);

  async function fetchInvites() {
    setLoading(true);
    try {
      const query = role === "SUPER_ADMIN" ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
      const res = await fetch(`/api/admin/lecturer-invites${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch invites");
      setInvites(data.invites || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch invites");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { invitedEmail, ttlHours };
      if (role === "SUPER_ADMIN") payload.organizationId = organizationId;

      const res = await fetch("/api/admin/lecturer-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create invite");
      toast.success(`Invite created for ${invitedEmail}`);
      setInvitedEmail("");
      await fetchInvites();
    } catch (err: any) {
      toast.error(err.message || "Failed to create invite");
    } finally {
      setSubmitting(false);
    }
  }

  async function runInviteAction(id: string, action: "resend" | "revoke") {
    try {
      const payload: Record<string, unknown> = { action };
      if (role === "SUPER_ADMIN") payload.organizationId = organizationId;

      const res = await fetch(`/api/admin/lecturer-invites/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action} invite`);
      toast.success(`Invite ${action} completed.`);
      await fetchInvites();
    } catch (err: any) {
      toast.error(err.message || `Failed to ${action} invite`);
    }
  }

  if (!session?.user) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Lecturer Invites"
        description="Invite lecturers to create accounts. Public lecturer signup is disabled."
      />

      {role === "SUPER_ADMIN" && (
        <div className="surface space-y-2 p-4">
          <label htmlFor="organizationId" className="text-sm font-medium">
            Organization ID
          </label>
          <input
            id="organizationId"
            value={organizationIdInput}
            onChange={(e) => setOrganizationIdInput(e.target.value)}
            placeholder="Required for super-admin"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}

      <form onSubmit={handleCreateInvite} className="surface space-y-4 p-4">
        <div className="space-y-2">
          <label htmlFor="invitedEmail" className="text-sm font-medium">
            Lecturer Email
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="invitedEmail"
              type="email"
              value={invitedEmail}
              onChange={(e) => setInvitedEmail(e.target.value)}
              required
              placeholder="lecturer@university.edu"
              className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor="ttlHours" className="text-sm font-medium">
            Invite expires in (hours)
          </label>
          <input
            id="ttlHours"
            type="number"
            min={1}
            max={168}
            value={ttlHours}
            onChange={(e) => setTtlHours(Number(e.target.value))}
            className="flex h-10 w-40 rounded-md border border-input bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <button
          type="submit"
          disabled={submitting || (role === "SUPER_ADMIN" && !organizationId)}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send Invite
        </button>
      </form>

      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Expires</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                  </td>
                </tr>
              ) : invites.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No lecturer invites yet.
                  </td>
                </tr>
              ) : (
                invites.map((invite) => {
                  const status = invite.acceptedAt
                    ? "Accepted"
                    : invite.revokedAt
                    ? "Revoked"
                    : new Date(invite.expiresAt) < new Date()
                    ? "Expired"
                    : "Pending";

                  return (
                    <tr key={invite.id}>
                      <td className="px-4 py-3">{invite.invitedEmail}</td>
                      <td className="px-4 py-3">{status}</td>
                      <td className="px-4 py-3">{new Date(invite.expiresAt).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => runInviteAction(invite.id, "resend")}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                          >
                            <RefreshCcw className="h-3 w-3" />
                            Resend
                          </button>
                          <button
                            type="button"
                            onClick={() => runInviteAction(invite.id, "revoke")}
                            className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive hover:bg-destructive/20"
                          >
                            <Ban className="h-3 w-3" />
                            Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

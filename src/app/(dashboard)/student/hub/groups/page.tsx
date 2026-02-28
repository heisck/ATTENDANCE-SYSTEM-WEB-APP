"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { StudentHubShell } from "@/components/student-hub/student-hub-shell";

type GroupRow = {
  id: string;
  name: string;
  capacity: number;
  leaderId: string | null;
  _count: { memberships: number };
  memberships: Array<{ studentId: string; groupId: string }>;
  link?: { inviteUrl: string | null } | null;
};

type SessionRow = {
  id: string;
  title: string | null;
  mode: "SELF_SELECT" | "RANDOM_ASSIGNMENT";
  leaderMode: "VOLUNTEER_VOTE" | "VOLUNTEER_FIRST_COME" | "RANDOM";
  startsAt: string;
  endsAt: string;
  groupSize: number;
  course?: { code: string; name: string } | null;
  cohort?: { displayName: string } | null;
  groups: GroupRow[];
};

type Membership = {
  id: string;
  groupId: string;
  group: { id: string; name: string; sessionId: string };
};

export default function StudentHubGroupsPage() {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [createGroupName, setCreateGroupName] = useState<Record<string, string>>({});
  const [voteCandidate, setVoteCandidate] = useState<Record<string, string>>({});
  const [groupLink, setGroupLink] = useState<Record<string, string>>({});

  const membershipsBySession = useMemo(() => {
    const map = new Map<string, Membership>();
    for (const item of memberships) {
      map.set(item.group.sessionId, item);
    }
    return map;
  }, [memberships]);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const response = await fetch("/api/student/hub/group-sessions", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load group sessions");
      setSessions(data.sessions || []);
      setMemberships(data.memberships || []);
    } catch (error: any) {
      toast.error(error?.message || "Failed to load group sessions");
    } finally {
      setLoading(false);
    }
  }

  async function createSelfSelectGroup(sessionId: string) {
    const name = (createGroupName[sessionId] || "").trim();
    if (!name) {
      toast.error("Enter a group name first");
      return;
    }
    try {
      const response = await fetch(`/api/student/hub/group-sessions/${sessionId}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create group");
      toast.success("Group created and joined");
      setCreateGroupName((prev) => ({ ...prev, [sessionId]: "" }));
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to create group");
    }
  }

  async function joinGroup(sessionId: string, groupId: string) {
    try {
      const response = await fetch(`/api/student/hub/group-sessions/${sessionId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to join group");
      toast.success("Joined group");
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to join group");
    }
  }

  async function voteLeader(groupId: string) {
    const candidateStudentId = (voteCandidate[groupId] || "").trim();
    if (!candidateStudentId) {
      toast.error("Enter candidate student ID");
      return;
    }
    try {
      const response = await fetch(`/api/student/hub/groups/${groupId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateStudentId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Vote failed");
      toast.success(data.electedLeaderId ? "Leader elected" : "Vote submitted");
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Vote failed");
    }
  }

  async function publishLink(groupId: string) {
    const inviteUrl = (groupLink[groupId] || "").trim();
    if (!inviteUrl) {
      toast.error("Enter WhatsApp invite URL");
      return;
    }
    try {
      const response = await fetch(`/api/student/hub/groups/${groupId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to publish link");
      toast.success("Group link published");
      setGroupLink((prev) => ({ ...prev, [groupId]: data.link?.inviteUrl || inviteUrl }));
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to publish link");
    }
  }

  const totalGroups = sessions.reduce((sum, session) => sum + session.groups.length, 0);
  const openSlots = sessions.reduce(
    (sum, session) =>
      sum + session.groups.reduce((groupSum, group) => groupSum + Math.max(group.capacity - group._count.memberships, 0), 0),
    0,
  );

  return (
    <div className="space-y-6">
      <StudentHubShell
        title="Group Formation"
        description="Join groups, vote leaders, and publish invite links with the updated Student Hub experience."
        activeRoute="groups"
        metrics={[
          { label: "Active Sessions", value: String(sessions.length) },
          { label: "Your Memberships", value: String(memberships.length) },
          { label: "Available Groups", value: String(totalGroups) },
          { label: "Open Slots", value: String(openSlots) },
        ]}
      />

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="surface p-4 text-sm text-muted-foreground">No group sessions currently available.</div>
      ) : (
        sessions.map((session) => {
          const ownMembership = membershipsBySession.get(session.id);
          return (
            <section key={session.id} className="surface space-y-4 p-4">
              <div>
                <p className="text-sm font-semibold">
                  {session.title || `${session.course?.code || "Course"} group formation`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {session.course ? `${session.course.code} - ${session.course.name}` : session.cohort?.displayName || "-"}
                  {" · "}
                  {session.mode} · Leader: {session.leaderMode}
                </p>
              </div>

              {session.mode === "SELF_SELECT" && !ownMembership ? (
                <form
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    void createSelfSelectGroup(session.id);
                  }}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input
                    value={createGroupName[session.id] || ""}
                    onChange={(event) =>
                      setCreateGroupName((prev) => ({ ...prev, [session.id]: event.target.value }))
                    }
                    placeholder="New group name"
                    className="h-10 min-w-56 rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm"
                  >
                    <Plus className="h-4 w-4" />
                    Create Group
                  </button>
                </form>
              ) : null}

              <div className="grid gap-3">
                {session.groups.map((group) => {
                  const inGroup = Boolean(group.memberships[0]);
                  const ownGroup = ownMembership?.groupId === group.id;
                  return (
                    <article key={group.id} className="rounded-lg border border-border/70 bg-background/40 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{group.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {group._count.memberships}/{group.capacity}
                        </p>
                      </div>

                      {ownMembership ? (
                        ownGroup ? (
                          <p className="mt-2 text-xs font-medium text-foreground">Your group</p>
                        ) : (
                          <p className="mt-2 text-xs text-muted-foreground">You are already in another group.</p>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() => void joinGroup(session.id, group.id)}
                          disabled={group._count.memberships >= group.capacity}
                          className="mt-2 inline-flex h-8 items-center rounded-md border border-border px-3 text-xs disabled:opacity-50"
                        >
                          Join Group
                        </button>
                      )}

                      {ownGroup && session.leaderMode === "VOLUNTEER_VOTE" ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <input
                            value={voteCandidate[group.id] || ""}
                            onChange={(event) =>
                              setVoteCandidate((prev) => ({ ...prev, [group.id]: event.target.value }))
                            }
                            placeholder="Candidate student ID"
                            className="h-9 min-w-52 rounded-md border border-input bg-background px-3 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => void voteLeader(group.id)}
                            className="h-9 rounded-md border border-border px-3 text-xs"
                          >
                            Vote Leader
                          </button>
                        </div>
                      ) : null}

                      {ownGroup ? (
                        <div className="mt-3 space-y-2">
                          <input
                            value={groupLink[group.id] || group.link?.inviteUrl || ""}
                            onChange={(event) =>
                              setGroupLink((prev) => ({ ...prev, [group.id]: event.target.value }))
                            }
                            placeholder="https://chat.whatsapp.com/..."
                            className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => void publishLink(group.id)}
                            className="h-9 rounded-md border border-border px-3 text-xs"
                          >
                            Publish WhatsApp Link
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

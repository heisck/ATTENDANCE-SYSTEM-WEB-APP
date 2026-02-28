import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";
import { groupLeaderVoteSchema } from "@/lib/validators";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getStudentHubContext(session.user.id);
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!context.organizationId) {
    return NextResponse.json({ error: "No organization context" }, { status: 400 });
  }
  if (!context.featureFlags.studentHubCore || !context.featureFlags.groupFormation) {
    return NextResponse.json({ error: "groupFormation feature is disabled" }, { status: 404 });
  }

  const { id: groupId } = await params;
  const group = await db.studentGroup.findUnique({
    where: { id: groupId },
    include: {
      session: {
        select: {
          organizationId: true,
          leaderMode: true,
          active: true,
          startsAt: true,
          endsAt: true,
        },
      },
      memberships: {
        select: { studentId: true },
      },
    },
  });
  if (!group || group.session.organizationId !== context.organizationId) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }
  if (group.session.leaderMode !== "VOLUNTEER_VOTE") {
    return NextResponse.json({ error: "Leader vote is disabled for this group session." }, { status: 400 });
  }

  const now = new Date();
  if (!group.session.active || now < group.session.startsAt || now > group.session.endsAt) {
    return NextResponse.json({ error: "Voting is outside the active session window." }, { status: 400 });
  }

  const memberIds = new Set(group.memberships.map((row) => row.studentId));
  if (!memberIds.has(context.userId)) {
    return NextResponse.json({ error: "Only group members can vote." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = groupLeaderVoteSchema.parse(body);
    if (!memberIds.has(parsed.candidateStudentId)) {
      return NextResponse.json({ error: "Candidate is not a member of this group." }, { status: 400 });
    }

    await db.groupLeaderVote.upsert({
      where: {
        groupId_voterId: {
          groupId,
          voterId: context.userId,
        },
      },
      update: {
        candidateStudentId: parsed.candidateStudentId,
      },
      create: {
        groupId,
        voterId: context.userId,
        candidateStudentId: parsed.candidateStudentId,
      },
    });

    const votes = await db.groupLeaderVote.findMany({
      where: { groupId },
      select: { candidateStudentId: true },
    });

    const tally = votes.reduce<Record<string, number>>((acc, vote) => {
      acc[vote.candidateStudentId] = (acc[vote.candidateStudentId] || 0) + 1;
      return acc;
    }, {});

    const majorityThreshold = Math.floor(memberIds.size / 2) + 1;
    const winner = Object.entries(tally).find(([, count]) => count >= majorityThreshold);
    if (winner) {
      await db.studentGroup.update({
        where: { id: groupId },
        data: {
          leaderId: winner[0],
        },
      });
    }

    return NextResponse.json({
      success: true,
      tally,
      electedLeaderId: winner?.[0] || null,
      majorityThreshold,
    });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Group vote error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


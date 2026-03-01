import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  Classof2028Dashboard,
  type DashboardHeroInfo,
  type DashboardHeroStatus,
} from "@/components/student-hub/classof2028-dashboard";

function weekdayMonFirst(date: Date) {
  return ((date.getDay() + 6) % 7) + 1;
}

function toMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function getNextOccurrence(entry: { dayOfWeek: number; startTime: string; endTime: string }, now: Date) {
  const nowWeekday = weekdayMonFirst(now);
  const startMin = toMinutes(entry.startTime);
  const endMin = toMinutes(entry.endTime);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  let offsetDays = entry.dayOfWeek - nowWeekday;
  if (offsetDays < 0 || (offsetDays === 0 && startMin <= nowMin)) {
    offsetDays += 7;
  }

  const startAt = new Date(now);
  startAt.setDate(now.getDate() + offsetDays);
  startAt.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);

  const endAt = new Date(startAt);
  endAt.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
  if (endMin <= startMin) {
    endAt.setDate(endAt.getDate() + 1);
  }

  return { startAt, endAt };
}

function mapClassUpdateState(type?: string): DashboardHeroStatus {
  switch (type) {
    case "CANCELLED":
      return "CANCELLED";
    case "RESCHEDULED":
      return "POSTPONED";
    case "VENUE_CHANGE":
      return "VENUE_CHANGED";
    default:
      return "COMING_ON";
  }
}

function mapExamUpdateState(type?: string): DashboardHeroStatus {
  const normalized = (type || "").toUpperCase();
  if (normalized.includes("CANCEL")) return "CANCELLED";
  if (normalized.includes("POSTPON") || normalized.includes("RESCHED")) return "POSTPONED";
  if (normalized.includes("VENUE") || normalized.includes("HALL")) return "VENUE_CHANGED";
  return "COMING_ON";
}

function formatDateTimeRange(start: Date, end?: Date | null) {
  const startText = start.toLocaleString();
  if (!end) return startText;
  return `${startText} - ${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function extractVenueFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.newVenue === "string" && record.newVenue.trim().length > 0) return record.newVenue.trim();
  if (typeof record.venue === "string" && record.venue.trim().length > 0) return record.venue.trim();
  return null;
}

function formatUpdater(name?: string | null, role?: string | null) {
  if (!name) return null;
  if (!role) return name;
  if (role === "STUDENT") return `${name} (Course Rep)`;
  return `${name} (${role.toLowerCase().replace(/_/g, " ")})`;
}

export default async function StudentHubDashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const context = await getStudentHubContext(session.user.id);
  if (!context) {
    redirect("/login");
  }

  if (!context.featureFlags.studentHubCore) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Student Hub"
          title="Dashboard"
          description="Student Hub is disabled for this organization."
        />
      </div>
    );
  }

  let classInfo: DashboardHeroInfo | null = null;
  let examInfo: DashboardHeroInfo | null = null;
  const now = new Date();

  if (context.organizationId && context.cohortId) {
    const entries = await db.timetableEntry.findMany({
      where: {
        organizationId: context.organizationId,
        cohortId: context.cohortId,
        isActive: true,
      },
      include: {
        course: {
          select: { id: true, code: true, name: true },
        },
      },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
      take: 200,
    });

    if (entries.length > 0) {
      const next = entries
        .map((entry) => ({
          entry,
          ...getNextOccurrence(
            {
              dayOfWeek: entry.dayOfWeek,
              startTime: entry.startTime,
              endTime: entry.endTime,
            },
            now,
          ),
        }))
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];

      if (next) {
        const windowStart = new Date(next.startAt.getTime() - 24 * 60 * 60 * 1000);
        const windowEnd = new Date(next.startAt.getTime() + 24 * 60 * 60 * 1000);

        const courseSpecificUpdate = next.entry.courseId
          ? await db.classUpdate.findFirst({
              where: {
                organizationId: context.organizationId,
                isActive: true,
                courseId: next.entry.courseId,
                effectiveAt: { gte: windowStart, lte: windowEnd },
              },
              include: {
                createdBy: {
                  select: { name: true, role: true },
                },
              },
              orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
            })
          : null;

        const cohortUpdate =
          !courseSpecificUpdate && context.cohortId
            ? await db.classUpdate.findFirst({
                where: {
                  organizationId: context.organizationId,
                  isActive: true,
                  cohortId: context.cohortId,
                  courseId: null,
                  effectiveAt: { gte: windowStart, lte: windowEnd },
                },
                include: {
                  createdBy: {
                    select: { name: true, role: true },
                  },
                },
                orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
              })
            : null;

        const classUpdate = courseSpecificUpdate ?? cohortUpdate;
        const mappedState = mapClassUpdateState(classUpdate?.type);
        const mappedVenue =
          mappedState === "VENUE_CHANGED"
            ? extractVenueFromPayload(classUpdate?.payload) || next.entry.venue || "Venue changed"
            : next.entry.venue || (next.entry.mode === "ONLINE" ? "Online class" : next.entry.mode === "HYBRID" ? "Hybrid class" : "TBA");

        classInfo = {
          contextLabel: "Next Class",
          courseName: next.entry.course?.name || next.entry.courseTitle,
          courseCode: next.entry.course?.code || next.entry.courseCode,
          timeLabel: formatDateTimeRange(next.startAt, next.endAt),
          startAt: next.startAt.toISOString(),
          endAt: next.endAt.toISOString(),
          state: mappedState,
          venueLabel: mappedVenue,
          updatedBy: formatUpdater(classUpdate?.createdBy?.name || null, classUpdate?.createdBy?.role || null),
          updatedAt: classUpdate?.effectiveAt?.toISOString() || null,
        };
      }
    }
  }

  if (context.organizationId && context.featureFlags.examHub) {
    const scopeFilters: Array<Record<string, unknown>> = [];
    if (context.cohortId) {
      scopeFilters.push({ cohortId: context.cohortId });
    }
    if (context.enrolledCourseIds.length > 0) {
      scopeFilters.push({ courseId: { in: context.enrolledCourseIds } });
    }

    if (scopeFilters.length > 0) {
      const upcomingExam = await db.examEntry.findFirst({
        where: {
          organizationId: context.organizationId,
          OR: scopeFilters,
          examDate: { gte: now },
        },
        include: {
          course: { select: { code: true, name: true } },
          updates: { orderBy: { effectiveAt: "desc" }, take: 1 },
        },
        orderBy: { examDate: "asc" },
      });

      if (upcomingExam) {
        const latestUpdate = upcomingExam.updates[0];
        const editor =
          latestUpdate?.createdByUserId
            ? await db.user.findUnique({
                where: { id: latestUpdate.createdByUserId },
                select: { name: true, role: true },
              })
            : null;

        examInfo = {
          contextLabel: "Upcoming Exam",
          courseName: upcomingExam.course?.name || upcomingExam.title,
          courseCode: upcomingExam.course?.code || "EXAM",
          timeLabel: formatDateTimeRange(upcomingExam.examDate, upcomingExam.endAt),
          startAt: upcomingExam.examDate.toISOString(),
          endAt: upcomingExam.endAt?.toISOString() || null,
          state: mapExamUpdateState(latestUpdate?.updateType),
          venueLabel: upcomingExam.allowAnyHall ? "Any listed hall" : upcomingExam.venue || "TBA",
          updatedBy: formatUpdater(editor?.name || null, editor?.role || null),
          updatedAt: latestUpdate?.effectiveAt?.toISOString() || null,
        };
      }
    }
  }

  const fallbackClassStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  fallbackClassStart.setHours(12, 30, 0, 0);
  const fallbackClassEnd = new Date(fallbackClassStart);
  fallbackClassEnd.setHours(14, 0, 0, 0);

  const fallbackExamStart = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  fallbackExamStart.setHours(9, 0, 0, 0);
  const fallbackExamEnd = new Date(fallbackExamStart);
  fallbackExamEnd.setHours(11, 0, 0, 0);

  const resolvedClassInfo: DashboardHeroInfo =
    classInfo ?? {
      contextLabel: "Next Class",
      courseName: "DevOps and Release Engineering",
      courseCode: "SWE 412",
      timeLabel: formatDateTimeRange(fallbackClassStart, fallbackClassEnd),
      startAt: fallbackClassStart.toISOString(),
      endAt: fallbackClassEnd.toISOString(),
      state: "COMING_ON",
      venueLabel: "Lab B2",
      updatedBy: "Yakubu (Course Rep)",
      updatedAt: now.toISOString(),
    };

  const resolvedExamInfo: DashboardHeroInfo =
    examInfo ?? {
      contextLabel: "Upcoming Exam",
      courseName: "Information Security",
      courseCode: "CSE 428",
      timeLabel: formatDateTimeRange(fallbackExamStart, fallbackExamEnd),
      startAt: fallbackExamStart.toISOString(),
      endAt: fallbackExamEnd.toISOString(),
      state: "COMING_ON",
      venueLabel: "Main Hall 3",
      updatedBy: "Oluchi (Course Rep)",
      updatedAt: now.toISOString(),
    };

  return <Classof2028Dashboard classInfo={resolvedClassInfo} examInfo={resolvedExamInfo} />;
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";
import { PageHeader, SectionHeading } from "@/components/dashboard/page-header";

const weekdayLabels: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

export default async function StudentHubTimetablePage() {
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
          title="Timetable"
          description="Student Hub is disabled for this organization."
        />
      </div>
    );
  }

  if (!context.organizationId || !context.cohortId) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Student Hub"
          title="Timetable"
          description="Complete your profile cohort details to unlock timetable."
        />
      </div>
    );
  }

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
      cohort: {
        select: { id: true, displayName: true },
      },
    },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });

  const grouped = entries.reduce<Record<number, typeof entries>>((acc, entry) => {
    acc[entry.dayOfWeek] ||= [];
    acc[entry.dayOfWeek].push(entry);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Student Hub"
        title="Timetable"
        description="Your cohort schedule grouped by day."
      />

      <section className="space-y-3">
        <SectionHeading
          title="Week View"
          description={entries[0]?.cohort?.displayName || "Current cohort timetable"}
        />
        <div className="space-y-4">
          {Object.entries(grouped).length === 0 ? (
            <div className="surface p-5 text-sm text-muted-foreground">
              No timetable entries have been published for your cohort yet.
            </div>
          ) : (
            Object.entries(grouped).map(([dayKey, rows]) => (
              <section key={dayKey} className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {weekdayLabels[Number(dayKey)] || `Day ${dayKey}`}
                </h3>
                <div className="grid gap-3">
                  {rows.map((entry) => (
                    <article
                      key={entry.id}
                      className="rounded-xl border border-border/70 bg-background/40 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">
                          {entry.course?.code || entry.courseCode} - {entry.course?.name || entry.courseTitle}
                        </p>
                        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">
                          {entry.startTime} - {entry.endTime}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{entry.mode}</span>
                        {entry.venue ? <span>Venue: {entry.venue}</span> : null}
                        {entry.lecturerName ? <span>Lecturer: {entry.lecturerName}</span> : null}
                      </div>
                      {entry.onlineLink ? (
                        <a
                          href={entry.onlineLink}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex text-xs font-medium text-foreground underline underline-offset-2"
                        >
                          Open Class Link
                        </a>
                      ) : null}
                      {entry.notes ? (
                        <p className="mt-2 text-xs text-muted-foreground">{entry.notes}</p>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </section>
    </div>
  );
}


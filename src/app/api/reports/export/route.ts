import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getAttendanceReport,
  getAttendanceSessionReport,
} from "@/services/attendance.service";
import {
  buildCsv,
  buildPdfBuffer,
  buildXlsxBuffer,
  type ExportColumn,
} from "@/lib/report-export";

type StaffUser = {
  id: string;
  role: string;
  organizationId?: string | null;
};

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "");
}

function formatExportTimestamp(value: string) {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function canAccessCourse(user: StaffUser, input: {
  lecturerId: string;
  organizationId: string;
}) {
  if (!["LECTURER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return false;
  }

  if (user.role === "LECTURER") {
    return input.lecturerId === user.id;
  }

  if (user.role === "ADMIN") {
    return Boolean(user.organizationId) && user.organizationId === input.organizationId;
  }

  return true;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as StaffUser;
  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId");
  const sessionId = searchParams.get("sessionId");
  const rawFormat = (searchParams.get("format") || "csv").toLowerCase();
  const format = rawFormat === "excel" ? "xlsx" : rawFormat;

  if (!courseId && !sessionId) {
    return NextResponse.json(
      { error: "courseId or sessionId is required" },
      { status: 400 }
    );
  }

  if (sessionId) {
    const sessionAccess = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      select: {
        lecturerId: true,
        course: {
          select: {
            organizationId: true,
          },
        },
      },
    });

    if (!sessionAccess) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (
      !canAccessCourse(user, {
        lecturerId: sessionAccess.lecturerId,
        organizationId: sessionAccess.course.organizationId,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const report = await getAttendanceSessionReport(sessionId);
    if (!report) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sessionRows = report.records.map((row) => ({
      name: row.name,
      email: row.email,
      studentId: row.studentId,
      indexNumber: row.indexNumber,
      cohort: row.cohort,
      markedAt: formatExportTimestamp(row.markedAt),
      confidence: `${row.confidence}%`,
      flagged: row.flagged ? "Yes" : "No",
    }));
    const columns: ExportColumn<(typeof sessionRows)[number]>[] = [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "studentId", label: "Student Number" },
      { key: "indexNumber", label: "Index Number" },
      { key: "cohort", label: "Course / Level" },
      { key: "markedAt", label: "Marked At" },
      { key: "confidence", label: "Confidence" },
      { key: "flagged", label: "Flagged" },
    ];

    const fileBase = sanitizeFilePart(
      `${report.session.courseCode}_${report.session.date}_${report.session.sessionKind}_${report.session.id.slice(-6)}`
    );

    if (format === "pdf") {
      const buffer = await buildPdfBuffer({
        title: `${report.session.courseCode} Attendance Session`,
        subtitleLines: [
          `Course: ${report.session.courseCode} - ${report.session.courseName}`,
          `Date: ${report.session.date}`,
          `Session Type: ${report.session.sessionKind}`,
          `Phase: ${report.session.phaseLabel}`,
          `Students Marked: ${report.session.totalStudentsMarked} / ${report.session.totalEnrolled}`,
        ],
        columns,
        rows: sessionRows,
      });

      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${fileBase}.pdf"`,
        },
      });
    }

    if (format === "xlsx") {
      const buffer = await buildXlsxBuffer({
        sheetName: `${report.session.courseCode} Session`,
        columns,
        rows: sessionRows,
      });

      return new NextResponse(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${fileBase}.xlsx"`,
        },
      });
    }

    if (format === "csv") {
      const csv = buildCsv(columns, sessionRows);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${fileBase}.csv"`,
        },
      });
    }

    return NextResponse.json(report);
  }

  const courseAccess = await db.course.findUnique({
    where: { id: courseId! },
    select: {
      lecturerId: true,
      organizationId: true,
    },
  });

  if (!courseAccess) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  if (
    !canAccessCourse(user, {
      lecturerId: courseAccess.lecturerId,
      organizationId: courseAccess.organizationId,
    })
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const report = await getAttendanceReport(courseId!);
  if (!report) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const courseRows = report.report.map((row) => ({
    name: row.name,
    email: row.email,
    studentId: row.studentId,
    indexNumber: row.indexNumber,
    cohort: row.cohort,
    phaseOneDays: row.phaseOneDays,
    phaseTwoDays: row.phaseTwoDays,
    fullyPresentDays: row.fullyPresentDays,
    totalClassDays: row.totalClassDays,
    percentage: `${row.percentage}%`,
  }));
  const columns: ExportColumn<(typeof courseRows)[number]>[] = [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "studentId", label: "Student Number" },
    { key: "indexNumber", label: "Index Number" },
    { key: "cohort", label: "Course / Level" },
    { key: "phaseOneDays", label: "Phase 1 Days" },
    { key: "phaseTwoDays", label: "Phase 2 Days" },
    { key: "fullyPresentDays", label: "Fully Present Days" },
    { key: "totalClassDays", label: "Total Class Days" },
    { key: "percentage", label: "Attendance %" },
  ];

  const fileBase = sanitizeFilePart(
    `${report.course.code}_attendance_summary`
  );

  if (format === "pdf") {
    const buffer = await buildPdfBuffer({
      title: `${report.course.code} Attendance Summary`,
      subtitleLines: [
        `Course: ${report.course.code} - ${report.course.name}`,
        `Class Days Held: ${report.totalClassDays}`,
        `Students Enrolled: ${report.totalStudents}`,
        `Phase Rule: Full attendance requires both Phase 1 and Phase 2 in the same class session.`,
      ],
      columns,
      rows: courseRows,
    });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileBase}.pdf"`,
      },
    });
  }

  if (format === "xlsx") {
    const buffer = await buildXlsxBuffer({
      sheetName: `${report.course.code} Summary`,
      columns,
      rows: courseRows,
    });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileBase}.xlsx"`,
      },
    });
  }

  if (format === "csv") {
    const csv = buildCsv(columns, courseRows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${fileBase}.csv"`,
      },
    });
  }

  return NextResponse.json(report);
}

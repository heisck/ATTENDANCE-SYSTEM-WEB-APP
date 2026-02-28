import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  institutionalEmail: z.string().email("Invalid institutional email"),
  personalEmail: z.string().email("Invalid personal email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  studentId: z.string().min(1, "Student ID is required"),
  indexNumber: z.string().min(1, "Index Number is required"),
  organizationSlug: z.string().min(1, "Organization is required"),
  department: z.string().min(1).default("CS"),
  level: z.number().int().min(100).max(400),
  groupCode: z.string().min(1, "Group is required"),
}).superRefine((data, ctx) => {
  const institutionalEmail = data.institutionalEmail.toLowerCase().trim();
  const personalEmail = data.personalEmail.toLowerCase().trim();

  if (institutionalEmail === personalEmail) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["personalEmail"],
      message: "Personal email must be different from institutional email",
    });
  }
});

export const createSessionSchema = z.object({
  courseCode: z.string().min(1, "Course code is required"),
  gpsLat: z.number().min(-90).max(90),
  gpsLng: z.number().min(-180).max(180),
  radiusMeters: z.number().min(50).max(5000).default(500),
});

export const markAttendanceSchema = z.object({
  sessionId: z.string().min(1),
  qrToken: z.string().min(1),
  qrTimestamp: z.number(),
  gpsLat: z.number().min(-90).max(90),
  gpsLng: z.number().min(-180).max(180),
  gpsAccuracy: z.number().optional(),
});

export const createCourseSchema = z.object({
  code: z.string().min(1, "Course code is required"),
  name: z.string().min(1, "Course name is required"),
  description: z.string().optional(),
});

export const createOrganizationSchema = z.object({
  name: z.string().min(2, "Organization name is required"),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, and hyphens"),
  domain: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(16, "Reset token is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const lecturerInviteSchema = z.object({
  invitedEmail: z.string().email("Invalid lecturer email"),
  ttlHours: z.number().int().min(1).max(168).default(72),
});

export const courseRepInviteSchema = z.object({
  invitedEmail: z.string().email("Invalid student email"),
  ttlHours: z.number().int().min(1).max(168).default(72),
  cohortId: z.string().optional(),
  courseId: z.string().optional(),
  targetUserId: z.string().optional(),
}).superRefine((data, ctx) => {
  if (!data.cohortId && !data.courseId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cohortId"],
      message: "Provide cohortId or courseId for invite scope.",
    });
  }
});

export const courseRepAssignSchema = z.object({
  userId: z.string().optional(),
  email: z.string().email("Invalid student email").optional(),
  cohortId: z.string().optional(),
  courseId: z.string().optional(),
  active: z.boolean().optional().default(true),
}).superRefine((data, ctx) => {
  if (!data.userId && !data.email) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["userId"],
      message: "Provide userId or email for assignment.",
    });
  }
  if (!data.cohortId && !data.courseId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cohortId"],
      message: "Provide cohortId or courseId for assignment scope.",
    });
  }
});

export const timetableEntrySchema = z.object({
  cohortId: z.string().min(1, "cohortId is required"),
  courseId: z.string().optional(),
  courseCode: z.string().min(1, "courseCode is required"),
  courseTitle: z.string().min(1, "courseTitle is required"),
  lecturerName: z.string().optional(),
  taName: z.string().optional(),
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  venue: z.string().optional(),
  mode: z.enum(["PHYSICAL", "ONLINE", "HYBRID"]).default("PHYSICAL"),
  onlineLink: z.string().url().optional(),
  notes: z.string().optional(),
});

export const classUpdateSchema = z.object({
  cohortId: z.string().optional(),
  courseId: z.string().optional(),
  type: z.enum(["CANCELLED", "RESCHEDULED", "VENUE_CHANGE", "ONLINE_LINK", "TAKEOVER", "NOTICE"]),
  title: z.string().min(1, "title is required"),
  message: z.string().min(1, "message is required"),
  effectiveAt: z.string().datetime(),
  payload: z.record(z.string(), z.any()).optional(),
}).superRefine((data, ctx) => {
  if (!data.cohortId && !data.courseId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cohortId"],
      message: "Provide cohortId or courseId target.",
    });
  }
});

export const assignmentAnnouncementSchema = z.object({
  cohortId: z.string().optional(),
  courseId: z.string().optional(),
  title: z.string().min(1, "title is required"),
  body: z.string().min(1, "body is required"),
  dueAt: z.string().datetime(),
  submissionNote: z.string().optional(),
  isGroupAssignment: z.boolean().optional().default(false),
}).superRefine((data, ctx) => {
  if (!data.cohortId && !data.courseId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cohortId"],
      message: "Provide cohortId or courseId target.",
    });
  }
});

export const assignmentAttachmentInitSchema = z.object({
  fileName: z.string().min(1, "fileName is required"),
  mime: z.string().min(1, "mime is required"),
  bytes: z.number().int().positive(),
  resourceType: z.enum(["raw", "image", "video", "auto"]).optional().default("raw"),
});

export const assignmentAttachmentFinalizeSchema = z.object({
  publicId: z.string().min(1, "publicId is required"),
  resourceType: z.enum(["raw", "image", "video"]).optional().default("raw"),
  url: z.string().url("Valid attachment url is required"),
  fileName: z.string().min(1, "fileName is required"),
  bytes: z.number().int().positive(),
  mime: z.string().min(1, "mime is required"),
});

export const reminderRunSchema = z.object({
  batchSize: z.number().int().positive().max(500).optional().default(100),
});

export const examEntrySchema = z.object({
  cohortId: z.string().optional(),
  courseId: z.string().optional(),
  title: z.string().min(1, "title is required"),
  examDate: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  venue: z.string().optional(),
  allowAnyHall: z.boolean().optional().default(false),
  instructions: z.string().optional(),
}).superRefine((data, ctx) => {
  if (!data.cohortId && !data.courseId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cohortId"],
      message: "Provide cohortId or courseId target.",
    });
  }
});

export const examUpdateSchema = z.object({
  updateType: z.string().min(1, "updateType is required"),
  message: z.string().min(1, "message is required"),
  effectiveAt: z.string().datetime(),
  payload: z.record(z.string(), z.any()).optional(),
});

export const examAttachmentInitSchema = z.object({
  fileName: z.string().min(1, "fileName is required"),
  mime: z.string().min(1, "mime is required"),
  bytes: z.number().int().positive(),
  resourceType: z.enum(["raw", "image", "video", "auto"]).optional().default("raw"),
});

export const examAttachmentFinalizeSchema = z.object({
  publicId: z.string().min(1, "publicId is required"),
  resourceType: z.enum(["raw", "image", "video"]).optional().default("raw"),
  url: z.string().url("Valid attachment url is required"),
  fileName: z.string().min(1, "fileName is required"),
  bytes: z.number().int().positive(),
  mime: z.string().min(1, "mime is required"),
});

export const groupFormationSessionSchema = z.object({
  cohortId: z.string().optional(),
  courseId: z.string().optional(),
  title: z.string().optional(),
  groupSize: z.number().int().min(2).max(20).default(5),
  mode: z.enum(["SELF_SELECT", "RANDOM_ASSIGNMENT"]),
  leaderMode: z.enum(["VOLUNTEER_VOTE", "VOLUNTEER_FIRST_COME", "RANDOM"]),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  active: z.boolean().optional().default(true),
}).superRefine((data, ctx) => {
  if (!data.cohortId && !data.courseId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cohortId"],
      message: "Provide cohortId or courseId target.",
    });
  }
});

export const createStudentGroupSchema = z.object({
  name: z.string().min(1, "name is required"),
  capacity: z.number().int().min(2).max(20).optional(),
});

export const joinGroupSchema = z.object({
  groupId: z.string().min(1, "groupId is required"),
});

export const groupLeaderVoteSchema = z.object({
  candidateStudentId: z.string().min(1, "candidateStudentId is required"),
});

export const groupLinkSchema = z.object({
  inviteUrl: z.string().url("Valid WhatsApp invite URL is required"),
});

export const acceptLecturerInviteSchema = z.object({
  token: z.string().min(16, "Invite token is required"),
  name: z.string().min(2, "Name must be at least 2 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type LecturerInviteInput = z.infer<typeof lecturerInviteSchema>;
export type AcceptLecturerInviteInput = z.infer<typeof acceptLecturerInviteSchema>;
export type CourseRepInviteInput = z.infer<typeof courseRepInviteSchema>;
export type CourseRepAssignInput = z.infer<typeof courseRepAssignSchema>;
export type TimetableEntryInput = z.infer<typeof timetableEntrySchema>;
export type ClassUpdateInput = z.infer<typeof classUpdateSchema>;
export type AssignmentAnnouncementInput = z.infer<typeof assignmentAnnouncementSchema>;
export type AssignmentAttachmentInitInput = z.infer<typeof assignmentAttachmentInitSchema>;
export type AssignmentAttachmentFinalizeInput = z.infer<typeof assignmentAttachmentFinalizeSchema>;
export type ReminderRunInput = z.infer<typeof reminderRunSchema>;
export type ExamEntryInput = z.infer<typeof examEntrySchema>;
export type ExamUpdateInput = z.infer<typeof examUpdateSchema>;
export type ExamAttachmentInitInput = z.infer<typeof examAttachmentInitSchema>;
export type ExamAttachmentFinalizeInput = z.infer<typeof examAttachmentFinalizeSchema>;
export type GroupFormationSessionInput = z.infer<typeof groupFormationSessionSchema>;
export type CreateStudentGroupInput = z.infer<typeof createStudentGroupSchema>;
export type JoinGroupInput = z.infer<typeof joinGroupSchema>;
export type GroupLeaderVoteInput = z.infer<typeof groupLeaderVoteSchema>;
export type GroupLinkInput = z.infer<typeof groupLinkSchema>;

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
}).superRefine((data, ctx) => {
  const institutionalEmail = data.institutionalEmail.toLowerCase().trim();
  const personalEmail = data.personalEmail.toLowerCase().trim();

  if (!/^[^@\s]+@st\.knust\.edu\.gh$/i.test(institutionalEmail)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["institutionalEmail"],
      message: "Institutional email must be in the format name@st.knust.edu.gh",
    });
  }

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

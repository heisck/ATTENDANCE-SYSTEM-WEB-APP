import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["STUDENT", "LECTURER"]),
  studentId: z.string().optional(),
  indexNumber: z.string().optional(),
  organizationSlug: z.string().min(1, "Organization is required"),
}).superRefine((data, ctx) => {
  if (data.role === "STUDENT") {
    if (!data.studentId || data.studentId.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studentId"],
        message: "Student ID is required for students",
      });
    }
    if (!data.indexNumber || data.indexNumber.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["indexNumber"],
        message: "Index Number is required for students",
      });
    }
  }
});

export const createSessionSchema = z.object({
  courseId: z.string().min(1, "Course is required"),
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

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

import { db } from "@/lib/db";

export async function getStudentGateState(userId: string) {
  const [student, credentialCount] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        personalEmail: true,
        personalEmailVerifiedAt: true,
        faceEnrollment: {
          select: {
            status: true,
            primaryImageUrl: true,
          },
        },
      },
    }),
    db.webAuthnCredential.count({ where: { userId } }),
  ]);

  if (!student || student.role !== "STUDENT") {
    return {
      isStudent: false,
      requiresProfileCompletion: false,
      requiresEmailVerification: false,
      hasFaceEnrollment: true,
      requiresFaceEnrollment: false,
      hasPasskey: true,
      redirectPath: null as string | null,
    };
  }

  const requiresProfileCompletion = !student.personalEmail;
  const requiresEmailVerification = !!student.personalEmail && !student.personalEmailVerifiedAt;
  const hasFaceEnrollment =
    student.faceEnrollment?.status === "COMPLETED" &&
    typeof student.faceEnrollment.primaryImageUrl === "string" &&
    student.faceEnrollment.primaryImageUrl.length > 0;
  const requiresFaceEnrollment =
    !requiresProfileCompletion && !requiresEmailVerification && !hasFaceEnrollment;
  const hasPasskey = credentialCount > 0;

  let redirectPath: string | null = null;
  if (requiresProfileCompletion || requiresEmailVerification) {
    redirectPath = "/student/complete-profile";
  } else if (requiresFaceEnrollment) {
    redirectPath = "/student/enroll-face";
  } else if (!hasPasskey) {
    redirectPath = "/setup-device";
  }

  return {
    isStudent: true,
    requiresProfileCompletion,
    requiresEmailVerification,
    hasFaceEnrollment,
    requiresFaceEnrollment,
    hasPasskey,
    redirectPath,
  };
}

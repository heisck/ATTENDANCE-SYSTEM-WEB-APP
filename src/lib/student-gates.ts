import { db } from "@/lib/db";

export async function getStudentGateState(userId: string) {
  const [student, credentialCount] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        personalEmail: true,
        personalEmailVerifiedAt: true,
      },
    }),
    db.webAuthnCredential.count({ where: { userId } }),
  ]);

  if (!student || student.role !== "STUDENT") {
    return {
      isStudent: false,
      requiresProfileCompletion: false,
      requiresEmailVerification: false,
      hasPasskey: true,
      redirectPath: null as string | null,
    };
  }

  const requiresProfileCompletion = !student.personalEmail;
  const requiresEmailVerification = !!student.personalEmail && !student.personalEmailVerifiedAt;
  const hasPasskey = credentialCount > 0;

  let redirectPath: string | null = null;
  if (requiresProfileCompletion || requiresEmailVerification) {
    redirectPath = "/student/complete-profile";
  } else if (!hasPasskey) {
    redirectPath = "/setup-device";
  }

  return {
    isStudent: true,
    requiresProfileCompletion,
    requiresEmailVerification,
    hasPasskey,
    redirectPath,
  };
}

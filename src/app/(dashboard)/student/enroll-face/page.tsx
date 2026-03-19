import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getStudentGateState } from "@/lib/student-gates";
import { StudentFaceEnrollmentPanel } from "@/components/student-face-enrollment-panel";

export default async function StudentEnrollFacePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  if (session.user.role !== "STUDENT") {
    redirect("/student");
  }

  const gate = await getStudentGateState(session.user.id);
  if (gate.requiresProfileCompletion || gate.requiresEmailVerification) {
    redirect("/student/complete-profile");
  }

  if (gate.hasFaceEnrollment) {
    redirect(gate.hasPasskey ? "/student" : "/setup-device");
  }

  return <StudentFaceEnrollmentPanel userName={session.user.name || session.user.email || "Student"} />;
}

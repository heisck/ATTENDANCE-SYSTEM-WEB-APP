"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import {
  BadgeCheck,
  Building2,
  Eye,
  EyeOff,
  GraduationCap,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User,
} from "lucide-react";
import { AuthPageLayout } from "@/components/auth/auth-page-layout";
import Stepper, { Step } from "@/components/ui/stepper";

type RegisterForm = {
  firstName: string;
  lastName: string;
  otherNames: string;
  institutionalEmail: string;
  personalEmail: string;
  password: string;
  studentId: string;
  indexNumber: string;
  organizationSlug: string;
  signupToken: string;
  department: string;
  level: string;
  groupCode: string;
};

type SignupWindowResponse = {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  signupWindow: {
    expiresAt: string;
    department: string | null;
    level: number | null;
    groupCode: string | null;
    requireGroup: boolean;
  };
};

const INITIAL_FORM: RegisterForm = {
  firstName: "",
  lastName: "",
  otherNames: "",
  institutionalEmail: "",
  personalEmail: "",
  password: "",
  studentId: "",
  indexNumber: "",
  organizationSlug: "",
  signupToken: "",
  department: "CS",
  level: "100",
  groupCode: "",
};

function RegisterPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form, setForm] = useState<RegisterForm>(INITIAL_FORM);
  const [windowInfo, setWindowInfo] = useState<SignupWindowResponse | null>(null);
  const [windowLoading, setWindowLoading] = useState(true);
  const [windowError, setWindowError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [activeStep, setActiveStep] = useState(1);
  const [agreedToGuidelines, setAgreedToGuidelines] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const organizationSlug = searchParams.get("org")?.trim().toLowerCase() || "";
    const signupToken = searchParams.get("token")?.trim() || "";

    if (!organizationSlug || !signupToken) {
      setWindowError("This signup link is unavailable right now.");
      setWindowLoading(false);
      return;
    }

    setForm((prev) => ({
      ...prev,
      organizationSlug,
      signupToken,
    }));

    async function loadSignupWindow() {
      setWindowLoading(true);
      try {
        const response = await fetch(
          `/api/student-signup-window?org=${encodeURIComponent(organizationSlug)}&token=${encodeURIComponent(signupToken)}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );
        const data = (await response.json()) as SignupWindowResponse & { error?: string };

        if (!response.ok) {
          throw new Error(data.error || "Student signup is unavailable right now.");
        }

        if (!active) return;

        setWindowInfo(data);
        setWindowError(null);
        setForm((prev) => ({
          ...prev,
          organizationSlug,
          signupToken,
          department: data.signupWindow.department ?? prev.department,
          level: data.signupWindow.level != null ? String(data.signupWindow.level) : prev.level,
          groupCode: data.signupWindow.groupCode ?? prev.groupCode,
        }));
      } catch (error: any) {
        if (!active) return;
        setWindowError(error?.message || "This signup link is unavailable right now.");
      } finally {
        if (active) setWindowLoading(false);
      }
    }

    void loadSignupWindow();

    return () => {
      active = false;
    };
  }, [searchParams]);

  function update(field: keyof RegisterForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const groupIsRequired =
    windowInfo?.signupWindow.requireGroup && !(windowInfo.signupWindow.groupCode?.trim().length);
  const departmentLocked = Boolean(windowInfo?.signupWindow.department);
  const levelLocked = windowInfo?.signupWindow.level != null;
  const groupLocked = Boolean(windowInfo?.signupWindow.groupCode);

  function validateBeforeCreate() {
    if (!windowInfo || windowError) {
      toast.error("Student signup is not active right now.");
      return false;
    }

    const requiredFields: Array<{ key: keyof RegisterForm; label: string }> = [
      { key: "firstName", label: "First name" },
      { key: "lastName", label: "Last name" },
      { key: "institutionalEmail", label: "Institutional email" },
      { key: "personalEmail", label: "Personal email" },
      { key: "password", label: "Password" },
      { key: "studentId", label: "Student ID" },
      { key: "indexNumber", label: "Index number" },
      { key: "department", label: "Department" },
      { key: "level", label: "Level" },
    ];

    if (groupIsRequired) {
      requiredFields.push({ key: "groupCode", label: "Group" });
    }

    const missingField = requiredFields.find(({ key }) => !form[key].trim());
    if (missingField) {
      toast.error(`${missingField.label} is required.`);
      return false;
    }

    if (form.password.trim().length < 8) {
      toast.error("Password must be at least 8 characters.");
      return false;
    }

    if (!agreedToGuidelines) {
      toast.error("Please confirm you understand the attendance rules.");
      return false;
    }

    return true;
  }

  async function submitRegistration() {
    if (loading) return false;
    if (!validateBeforeCreate()) return false;

    setLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          level: Number(form.level),
          department: form.department.toUpperCase(),
          groupCode: form.groupCode.toUpperCase(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        const message = data?.error || "Sign up failed. Please try again.";
        toast.error(message);
        return false;
      }

      if (data?.emailSent === false) {
        toast.error("Account created, but we couldn't confirm email delivery yet.", {
          description: "After sign in, use Resend Verification from your profile.",
        });
      } else {
        toast.success("Account created successfully!", {
          description: "Check your personal inbox and verify your email.",
        });
      }

      const signInResult = (await signIn("credentials", {
        email: form.institutionalEmail.trim().toLowerCase(),
        password: form.password,
        redirect: false,
        callbackUrl: "/api/auth/signed-in-redirect",
      })) as { error?: string } | undefined;

      if (signInResult?.error) {
        toast.error("Account created, but automatic sign-in failed. Please sign in manually.");
        router.push("/login?registered=true");
        return true;
      }

      toast.success("Signed in successfully.", {
        description: "Redirecting to your dashboard.",
      });

      const redirectRes = await fetch("/api/auth/redirect-target", {
        method: "GET",
        cache: "no-store",
      });

      if (redirectRes.ok) {
        const redirectData = (await redirectRes.json()) as { redirectTo?: string };
        router.replace(redirectData.redirectTo || "/student");
        return true;
      }

      router.replace("/api/auth/signed-in-redirect");
      return true;
    } catch {
      toast.error("Something went wrong. Please try again.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  if (windowLoading) {
    return (
      <AuthPageLayout
        pageLabel="Student Signup"
        viewportMode="stable"
        contentMaxWidthClass="max-w-xl"
        headerLink={{ href: "/login", label: "Sign In" }}
      >
        <div className="flex w-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AuthPageLayout>
    );
  }

  if (windowError || !windowInfo) {
    return (
      <AuthPageLayout
        pageLabel="Student Signup"
        viewportMode="stable"
        contentMaxWidthClass="max-w-xl"
        headerLink={{ href: "/login", label: "Sign In" }}
      >
        <div className="surface space-y-4 p-6">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">Signup window unavailable</h1>
            <p className="text-sm text-muted-foreground">{windowError || "Signup unavailable."}</p>
          </div>
        </div>
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout
      pageLabel="Student Signup"
      viewportMode="stable"
      headerCounter={`${Math.min(activeStep, 5)}/5`}
      contentMaxWidthClass="max-w-4xl"
      headerLink={{ href: "/login", label: "Sign In" }}
    >
      <div className="flex min-h-full w-full flex-col">
        <Stepper
          className="flex min-h-0 w-full flex-1 flex-col justify-start px-0"
          initialStep={1}
          onStepChange={(step) => setActiveStep(step)}
          onFinalStepCompleted={submitRegistration}
          nextButtonProps={{ disabled: loading }}
          disableStepIndicators
          stepCircleContainerClassName="h-full max-w-none rounded-none border-0 bg-transparent shadow-none"
          stepContainerClassName="hidden"
          contentClassName="px-0 pb-2 sm:px-0 sm:pb-2"
          footerClassName="px-2 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] sm:px-2 sm:pb-[calc(env(safe-area-inset-bottom)+0.25rem)] lg:px-0 lg:pb-0"
          footerInnerClassName="mt-0 w-full"
        >
          <Step>
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                This signup link is controlled by your lecturer or administrator. Create your
                account before the registration window closes.
              </p>
              <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                <SummaryRow
                  label="Institution"
                  value={windowInfo.organization.name}
                />
                <SummaryRow
                  label="Signup closes"
                  value={new Date(windowInfo.signupWindow.expiresAt).toLocaleString()}
                />
                <SummaryRow
                  label="Department"
                  value={windowInfo.signupWindow.department || "Choose during signup"}
                />
                <SummaryRow
                  label="Level"
                  value={
                    windowInfo.signupWindow.level != null
                      ? String(windowInfo.signupWindow.level)
                      : "Choose during signup"
                  }
                />
                <SummaryRow
                  label="Group"
                  value={
                    windowInfo.signupWindow.groupCode ||
                    (windowInfo.signupWindow.requireGroup
                      ? "Required during signup"
                      : "Optional")
                  }
                />
              </div>
            </div>
          </Step>

          <Step>
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Important do&apos;s and don&apos;ts</h2>
              <p className="text-sm text-muted-foreground">
                These are the baseline policies for safe and valid use of the system.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-muted/35 p-4">
                  <p className="mb-2 text-sm font-semibold text-foreground">Do</p>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    <li>Use your own verified institutional account.</li>
                    <li>Use your own device and follow lecturer session rules.</li>
                    <li>Complete passkey setup on your own device only.</li>
                  </ul>
                </div>
                <div className="rounded-xl border border-border bg-muted/35 p-4">
                  <p className="mb-2 text-sm font-semibold text-foreground">Don&apos;t</p>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    <li>Share credentials, QR tokens, or passkey device access.</li>
                    <li>Attempt proxy attendance for another student.</li>
                    <li>Use spoofing tools or modified browser environments.</li>
                  </ul>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/35 p-4 text-sm text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Repeated policy violations can lead to attendance flags and administrator review.
                </p>
              </div>
            </div>
          </Step>

          <Step>
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Account identity</h2>
              <p className="text-sm text-muted-foreground">
                Enter your details exactly as used by your institution.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First Name" htmlFor="firstName">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="firstName"
                    value={form.firstName}
                    onChange={(e) => update("firstName", e.target.value)}
                    placeholder="First name"
                    className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>

                <Field label="Last Name" htmlFor="lastName">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="lastName"
                    value={form.lastName}
                    onChange={(e) => update("lastName", e.target.value)}
                    placeholder="Last name"
                    className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>

                <Field label="Other Names" htmlFor="otherNames">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="otherNames"
                    value={form.otherNames}
                    onChange={(e) => update("otherNames", e.target.value)}
                    placeholder="Other names"
                    className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>

                <Field label="Institutional Email" htmlFor="institutionalEmail">
                  <GraduationCap className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="institutionalEmail"
                    type="email"
                    value={form.institutionalEmail}
                    onChange={(e) => update("institutionalEmail", e.target.value)}
                    placeholder="Institutional email"
                    className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>

                <Field label="Personal Email" htmlFor="personalEmail">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="personalEmail"
                    type="email"
                    value={form.personalEmail}
                    onChange={(e) => update("personalEmail", e.target.value)}
                    placeholder="Personal email for verification"
                    className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>
              </div>
            </div>
          </Step>

          <Step>
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Academic and security details</h2>
              <p className="text-sm text-muted-foreground">
                These details are used to place your account in the correct class setup.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Password" htmlFor="password">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => update("password", e.target.value)}
                    placeholder="Password (minimum 8 characters)"
                    className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-10 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </Field>

                <Field label="Student ID" htmlFor="studentId">
                  <BadgeCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="studentId"
                    value={form.studentId}
                    onChange={(e) => update("studentId", e.target.value)}
                    placeholder="Student ID"
                    className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>

                <Field label="Index Number" htmlFor="indexNumber">
                  <BadgeCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="indexNumber"
                    value={form.indexNumber}
                    onChange={(e) => update("indexNumber", e.target.value)}
                    placeholder="Index number"
                    className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>

                <Field label="Department" htmlFor="department">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="department"
                    value={form.department}
                    onChange={(e) => update("department", e.target.value)}
                    placeholder="Department"
                    disabled={departmentLocked}
                    className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
                  />
                </Field>

                <Field label="Level" htmlFor="level">
                  <GraduationCap className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="level"
                    type="number"
                    min={100}
                    max={900}
                    step={100}
                    value={form.level}
                    onChange={(e) => update("level", e.target.value)}
                    placeholder="Level"
                    disabled={levelLocked}
                    className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
                  />
                </Field>

                <Field label={groupIsRequired ? "Group" : "Group (Optional)"} htmlFor="groupCode">
                  <BadgeCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="groupCode"
                    value={form.groupCode}
                    onChange={(e) => update("groupCode", e.target.value)}
                    placeholder={groupIsRequired ? "Group is required" : "Leave blank if not used"}
                    disabled={groupLocked}
                    className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
                  />
                </Field>
              </div>
            </div>
          </Step>

          <Step>
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Review and finish</h2>
              <p className="text-sm text-muted-foreground">
                Confirm your details before the signup window closes.
              </p>

              <div className="rounded-xl border border-border bg-muted/30 p-5 text-sm">
                <dl className="grid gap-2 sm:grid-cols-2">
                  <SummaryRow label="Institution" value={windowInfo.organization.name} />
                  <SummaryRow label="Signup closes" value={new Date(windowInfo.signupWindow.expiresAt).toLocaleString()} />
                  <SummaryRow label="First name" value={form.firstName || "Not set"} />
                  <SummaryRow label="Last name" value={form.lastName || "Not set"} />
                  <SummaryRow label="Other names" value={form.otherNames || "Not set"} />
                  <SummaryRow label="Institutional email" value={form.institutionalEmail || "Not set"} />
                  <SummaryRow label="Personal email" value={form.personalEmail || "Not set"} />
                  <SummaryRow label="Student ID" value={form.studentId || "Not set"} />
                  <SummaryRow label="Index number" value={form.indexNumber || "Not set"} />
                  <SummaryRow label="Department" value={form.department || "Not set"} />
                  <SummaryRow label="Level" value={form.level || "Not set"} />
                  <SummaryRow label="Group" value={form.groupCode || "Not set"} />
                </dl>
              </div>

              <label className="flex items-start gap-3 rounded-lg border border-border bg-background p-4">
                <input
                  type="checkbox"
                  checked={agreedToGuidelines}
                  onChange={(e) => setAgreedToGuidelines(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input"
                />
                <span className="text-sm text-muted-foreground">
                  I understand the onboarding guidance and I will not attempt proxy attendance,
                  account sharing, or identity spoofing.
                </span>
              </label>
            </div>
          </Step>
        </Stepper>
      </div>
    </AuthPageLayout>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <AuthPageLayout
          pageLabel="Student Signup"
          viewportMode="stable"
          contentMaxWidthClass="max-w-xl"
          headerLink={{ href: "/login", label: "Sign In" }}
        >
          <div className="flex w-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </AuthPageLayout>
      }
    >
      <RegisterPageContent />
    </Suspense>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
      >
        {label}
      </label>
      <div className="relative">{children}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

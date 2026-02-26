"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import {
  BadgeCheck,
  BookOpenCheck,
  Building2,
  Eye,
  EyeOff,
  GraduationCap,
  Lock,
  Mail,
  ShieldCheck,
  User,
} from "lucide-react";
import { AuthPageLayout } from "@/components/auth/auth-page-layout";
import Stepper, { Step } from "@/components/ui/stepper";

type RegisterForm = {
  name: string;
  institutionalEmail: string;
  personalEmail: string;
  password: string;
  studentId: string;
  indexNumber: string;
  organizationSlug: string;
};

const INITIAL_FORM: RegisterForm = {
  name: "",
  institutionalEmail: "",
  personalEmail: "",
  password: "",
  studentId: "",
  indexNumber: "",
  organizationSlug: "",
};

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState<RegisterForm>(INITIAL_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [activeStep, setActiveStep] = useState(1);
  const [agreedToGuidelines, setAgreedToGuidelines] = useState(false);
  const [loading, setLoading] = useState(false);

  function update(field: keyof RegisterForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function validateBeforeCreate() {
    const requiredFields: Array<{ key: keyof RegisterForm; label: string }> = [
      { key: "name", label: "Full name" },
      { key: "institutionalEmail", label: "Institutional email" },
      { key: "personalEmail", label: "Personal email" },
      { key: "password", label: "Password" },
      { key: "studentId", label: "Student ID" },
      { key: "indexNumber", label: "Index number" },
      { key: "organizationSlug", label: "University code" },
    ];

    const missingField = requiredFields.find(({ key }) => !form[key].trim());
    if (missingField) {
      toast.error(`${missingField.label} is required.`);
      return false;
    }

    if (!form.institutionalEmail.trim().toLowerCase().endsWith("@st.knust.edu.gh")) {
      toast.error("Institutional email must end with @st.knust.edu.gh");
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
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) {
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

  return (
    <AuthPageLayout
      pageLabel="Sign Up"
      headerCounter={`${Math.min(activeStep, 5)}/5`}
      contentMaxWidthClass="max-w-4xl"
      headerLink={{ href: "/login", label: "Sign In" }}
    >
      <div className="flex h-full w-full flex-col overflow-hidden">
        <Stepper
          className="flex h-full w-full flex-1 flex-col justify-start px-0"
          initialStep={1}
          onStepChange={(step) => setActiveStep(step)}
          onFinalStepCompleted={submitRegistration}
          nextButtonProps={{ disabled: loading }}
          disableStepIndicators
          stepCircleContainerClassName="h-full max-w-none rounded-none border-0 bg-transparent shadow-none"
          stepContainerClassName="hidden"
          contentClassName="px-0 pb-2 sm:px-0 sm:pb-2"
          footerClassName="px-2 pb-1 sm:px-2 sm:pb-1 lg:px-0 lg:pb-0"
          footerInnerClassName="mt-0 w-full"
        >
          <Step>
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                Before account creation, we walk you through how attendance works so you avoid
                mistakes that can get records flagged.
              </p>
              <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-sm font-medium">What this setup includes:</p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Platform rules for valid attendance marking.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Security expectations for your account and passkey.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Academic identity details required to activate your profile.</span>
                  </li>
                </ul>
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
                    <li>Enable location and follow lecturer session rules.</li>
                    <li>Complete passkey setup on your own device only.</li>
                  </ul>
                </div>
                <div className="rounded-xl border border-border bg-muted/35 p-4">
                  <p className="mb-2 text-sm font-semibold text-foreground">Don&apos;t</p>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    <li>Share credentials, QR tokens, or passkey device access.</li>
                    <li>Attempt proxy attendance for another student.</li>
                    <li>Use fake location tools or modified browser environments.</li>
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
                Enter your primary account details exactly as used by your institution.
              </p>

              <div className="space-y-4">
                <Field>
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="name"
                    value={form.name}
                    onChange={(e) => update("name", e.target.value)}
                    placeholder="Full name"
                    className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>

                <Field>
                  <GraduationCap className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="institutionalEmail"
                    type="email"
                    value={form.institutionalEmail}
                    onChange={(e) => update("institutionalEmail", e.target.value)}
                    placeholder="Institutional email (@st.knust.edu.gh)"
                    className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>

                <Field>
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="personalEmail"
                    type="email"
                    value={form.personalEmail}
                    onChange={(e) => update("personalEmail", e.target.value)}
                    placeholder="Personal email (for verification/reset)"
                    className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>
              </div>
            </div>
          </Step>

          <Step>
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Academic and security details</h2>
              <p className="text-sm text-muted-foreground">
                These details are used to map your account to the correct institution profile.
              </p>

              <div className="space-y-4">
                <Field>
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => update("password", e.target.value)}
                    placeholder="Password (minimum 8 characters)"
                    className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-10 py-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

                <Field>
                  <BadgeCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="studentId"
                    value={form.studentId}
                    onChange={(e) => update("studentId", e.target.value)}
                    placeholder="Student ID (e.g. 20241234)"
                    className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>

                <Field>
                  <BadgeCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="indexNumber"
                    value={form.indexNumber}
                    onChange={(e) => update("indexNumber", e.target.value)}
                    placeholder="Index number (e.g. ITC/24/0012)"
                    className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>

                <Field>
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="org"
                    value={form.organizationSlug}
                    onChange={(e) => update("organizationSlug", e.target.value)}
                    placeholder="University code (e.g. knust)"
                    className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>
              </div>
            </div>
          </Step>

          <Step>
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Review and finish</h2>
              <p className="text-sm text-muted-foreground">
                Confirm your details and acknowledge the attendance integrity rules.
              </p>

              <div className="rounded-xl border border-border bg-muted/30 p-5 text-sm">
                <dl className="grid gap-2 sm:grid-cols-2">
                  <SummaryRow label="Full name" value={form.name || "Not set"} />
                  <SummaryRow label="Institutional email" value={form.institutionalEmail || "Not set"} />
                  <SummaryRow label="Personal email" value={form.personalEmail || "Not set"} />
                  <SummaryRow label="Student ID" value={form.studentId || "Not set"} />
                  <SummaryRow label="Index number" value={form.indexNumber || "Not set"} />
                  <SummaryRow label="University code" value={form.organizationSlug || "Not set"} />
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
                  account sharing, or any location/identity spoofing.
                </span>
              </label>
            </div>
          </Step>
        </Stepper>

      </div>
    </AuthPageLayout>
  );
}

function Field({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="py-0.5">
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

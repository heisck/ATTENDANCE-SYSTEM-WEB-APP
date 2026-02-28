"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarClock,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  User,
} from "lucide-react";
import { toast } from "sonner";

type StudentProfile = {
  id: string;
  role: string;
  name: string;
  email: string;
  studentId: string | null;
  indexNumber: string | null;
  personalEmail: string | null;
  personalEmailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function StudentProfilePage() {
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingPersonalEmail, setSavingPersonalEmail] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [personalEmail, setPersonalEmail] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    next: false,
    confirm: false,
  });

  useEffect(() => {
    async function loadProfile() {
      setLoading(true);
      try {
        const res = await fetch("/api/auth/student-profile");
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Unable to load profile");
        }
        setProfile(data);
        setPersonalEmail(data.personalEmail || "");
      } catch (error: any) {
        toast.error(error?.message || "Unable to load profile");
      } finally {
        setLoading(false);
      }
    }

    void loadProfile();
  }, []);

  async function handleUpdatePersonalEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;

    const nextValue = personalEmail.trim();
    if (!nextValue) {
      toast.error("Personal email cannot be empty.");
      return;
    }
    if (nextValue === (profile.personalEmail || "")) {
      return;
    }

    setSavingPersonalEmail(true);
    try {
      const res = await fetch("/api/auth/student-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personalEmail: nextValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Unable to update personal email");
      }

      setProfile((current) =>
        current
          ? {
              ...current,
              personalEmail: nextValue,
              personalEmailVerifiedAt: null,
              updatedAt: new Date().toISOString(),
            }
          : current
      );
      toast.success(data?.message || "Personal email updated. Please verify your new email.");
    } catch (error: any) {
      toast.error(error?.message || "Unable to update personal email");
    } finally {
      setSavingPersonalEmail(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error("New password and confirmation do not match");
      return;
    }

    setChangingPassword(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(passwordForm),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        toast.error(data?.error || "Failed to change password");
        return;
      }

      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      toast.success("Password changed successfully");
    } catch {
      toast.error("Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  }

  const canSavePersonalEmail = useMemo(() => {
    if (!profile) return false;
    const nextValue = personalEmail.trim();
    return nextValue.length > 0 && nextValue !== (profile.personalEmail || "");
  }, [personalEmail, profile]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="surface p-4 text-sm text-muted-foreground">
        Unable to load your profile details right now.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Manage your account details and security settings.
      </p>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <section className="space-y-6">
          <div className="surface p-5 sm:p-6">
            <div className="mb-5 flex items-start gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-muted/40">
                <User className="h-5 w-5 text-muted-foreground" />
              </span>
              <div>
                <h2 className="text-base font-semibold tracking-tight">Identity Details</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Core profile data used across your attendance workspace.
                </p>
              </div>
            </div>

            <dl className="grid gap-4 sm:grid-cols-2">
              <InfoCard label="Full Name" value={profile.name} icon={<User className="h-4 w-4" />} />
              <InfoCard label="Institutional Email" value={profile.email} icon={<Mail className="h-4 w-4" />} />
              <InfoCard label="Student ID" value={profile.studentId || "Not set"} icon={<BadgeCheck className="h-4 w-4" />} />
              <InfoCard
                label="Index Number"
                value={profile.indexNumber || "Not set"}
                icon={<BadgeCheck className="h-4 w-4" />}
              />
              <InfoCard
                label="Personal Email"
                value={profile.personalEmail || "Not set"}
                icon={<Mail className="h-4 w-4" />}
              />
              <InfoCard
                label="Email Status"
                value={profile.personalEmailVerifiedAt ? "Personal email verified" : "Verification pending"}
                icon={<ShieldCheck className="h-4 w-4" />}
              />
            </dl>

            <form onSubmit={handleUpdatePersonalEmail} className="mt-6 space-y-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Update Personal Email
              </p>
              <div className="relative">
                <label htmlFor="personalEmail" className="sr-only">
                  Personal Email
                </label>
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="personalEmail"
                  type="email"
                  value={personalEmail}
                  onChange={(event) => setPersonalEmail(event.target.value)}
                  required
                  placeholder="you@example.com"
                  className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="h-4 w-4" />
                  {profile.personalEmailVerifiedAt ? "Verified" : "Verification pending"}
                </span>
                <button
                  type="submit"
                  disabled={savingPersonalEmail || !canSavePersonalEmail}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingPersonalEmail ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </span>
                  ) : (
                    "Save Personal Email"
                  )}
                </button>
              </div>
            </form>
          </div>

          <div className="surface p-5 sm:p-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Change Password</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Keep your account secure with a strong password.
              </p>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <PasswordField
                id="currentPassword"
                label="Current Password"
                value={passwordForm.currentPassword}
                onChange={(value) =>
                  setPasswordForm((prev) => ({ ...prev, currentPassword: value }))
                }
                show={showPasswords.current}
                onToggle={() => setShowPasswords((prev) => ({ ...prev, current: !prev.current }))}
                placeholder="Enter your current password"
              />

              <PasswordField
                id="newPassword"
                label="New Password"
                value={passwordForm.newPassword}
                onChange={(value) => setPasswordForm((prev) => ({ ...prev, newPassword: value }))}
                show={showPasswords.next}
                onToggle={() => setShowPasswords((prev) => ({ ...prev, next: !prev.next }))}
                placeholder="Create a new password"
              />

              <PasswordField
                id="confirmPassword"
                label="Confirm Password"
                value={passwordForm.confirmPassword}
                onChange={(value) =>
                  setPasswordForm((prev) => ({ ...prev, confirmPassword: value }))
                }
                show={showPasswords.confirm}
                onToggle={() => setShowPasswords((prev) => ({ ...prev, confirm: !prev.confirm }))}
                placeholder="Re-enter new password"
              />

              <button
                type="submit"
                disabled={changingPassword}
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
              >
                {changingPassword ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Updating...
                  </span>
                ) : (
                  "Update Password"
                )}
              </button>
            </form>
          </div>
        </section>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <section className="surface p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Account Timeline
            </h3>
            <div className="mt-4 space-y-3">
              <InfoCard
                label="Account Created"
                value={new Date(profile.createdAt).toLocaleString()}
                icon={<CalendarClock className="h-4 w-4" />}
              />
              <InfoCard
                label="Last Updated"
                value={new Date(profile.updatedAt).toLocaleString()}
                icon={<CalendarClock className="h-4 w-4" />}
              />
            </div>
          </section>
          <section className="surface-muted p-5">
            <h3 className="text-sm font-semibold">Security Notes</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>Use a unique password you do not reuse elsewhere.</li>
              <li>Keep your personal email verified for account recovery.</li>
              <li>Review your profile details periodically.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function InfoCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-3">
      <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        <span>{value}</span>
      </dd>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  show,
  onToggle,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <div className="relative">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          minLength={8}
          placeholder={placeholder}
          className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-10 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

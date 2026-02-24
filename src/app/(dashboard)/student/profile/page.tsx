"use client";

import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  ShieldCheck,
  User,
  Mail,
  BadgeCheck,
  CalendarClock,
  KeyRound,
  Eye,
  EyeOff,
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

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      const message = "New password and confirmation do not match";
      toast.error(message);
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
        const message = data?.error || "Failed to change password";
        toast.error(message);
        return;
      }

      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      toast.success("Password changed successfully");
    } catch {
      const message = "Failed to change password";
      toast.error(message);
    } finally {
      setChangingPassword(false);
    }
  }

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
      <div className="mx-auto w-full max-w-3xl">
        <div className="surface p-4 text-sm text-muted-foreground">
          Unable to load your profile details right now.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <section className="surface p-5 sm:p-6">
        <div className="space-y-4">
          <ReadOnlyField
            id="fullName"
            label="Full Name"
            value={profile.name}
            icon={<User className="h-4 w-4 text-muted-foreground" />}
          />
          <ReadOnlyField
            id="institutionEmail"
            label="Institutional Email"
            value={profile.email}
            icon={<Mail className="h-4 w-4 text-muted-foreground" />}
          />
          <ReadOnlyField
            id="studentId"
            label="Student ID"
            value={profile.studentId || "Not set"}
            icon={<BadgeCheck className="h-4 w-4 text-muted-foreground" />}
          />
          <ReadOnlyField
            id="indexNumber"
            label="Index Number"
            value={profile.indexNumber || "Not set"}
            icon={<BadgeCheck className="h-4 w-4 text-muted-foreground" />}
          />
          <ReadOnlyField
            id="createdAt"
            label="Account Created"
            value={new Date(profile.createdAt).toLocaleString()}
            icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
          />
          <ReadOnlyField
            id="updatedAt"
            label="Last Updated"
            value={new Date(profile.updatedAt).toLocaleString()}
            icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
          />
        </div>

        <form onSubmit={handleUpdatePersonalEmail} className="mt-5 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Personal Email
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
      </section>

      <div className="surface p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Change Password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep your account secure with a strong password.
          </p>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Current Password
            </p>
            <div className="relative">
              <label htmlFor="currentPassword" className="sr-only">
                Current Password
              </label>
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="currentPassword"
                type={showPasswords.current ? "text" : "password"}
                value={passwordForm.currentPassword}
                onChange={(e) =>
                  setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))
                }
                required
                placeholder="Enter your current password"
                className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-10 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="button"
                onClick={() =>
                  setShowPasswords((prev) => ({ ...prev, current: !prev.current }))
                }
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={showPasswords.current ? "Hide current password" : "Show current password"}
              >
                {showPasswords.current ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              New Password
            </p>
            <div className="relative">
              <label htmlFor="newPassword" className="sr-only">
                New Password
              </label>
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="newPassword"
                type={showPasswords.next ? "text" : "password"}
                value={passwordForm.newPassword}
                onChange={(e) =>
                  setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))
                }
                required
                minLength={8}
                placeholder="Create a new password"
                className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-10 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="button"
                onClick={() => setShowPasswords((prev) => ({ ...prev, next: !prev.next }))}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={showPasswords.next ? "Hide new password" : "Show new password"}
              >
                {showPasswords.next ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">At least 8 characters recommended</p>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Confirm Password
            </p>
            <div className="relative">
              <label htmlFor="confirmPassword" className="sr-only">
                Confirm New Password
              </label>
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="confirmPassword"
                type={showPasswords.confirm ? "text" : "password"}
                value={passwordForm.confirmPassword}
                onChange={(e) =>
                  setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
                }
                required
                minLength={8}
                placeholder="Re-enter new password"
                className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-10 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="button"
                onClick={() =>
                  setShowPasswords((prev) => ({ ...prev, confirm: !prev.confirm }))
                }
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={
                  showPasswords.confirm ? "Hide confirm new password" : "Show confirm new password"
                }
              >
                {showPasswords.confirm ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

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
    </div>
  );
}

function ReadOnlyField({
  id,
  label,
  value,
  icon,
}: {
  id: string;
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
            {icon}
          </span>
        )}
        <input
          id={id}
          value={value}
          readOnly
          aria-readonly="true"
          className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/25 py-2 pl-10 pr-4 text-sm text-foreground/90"
        />
      </div>
    </div>
  );
}

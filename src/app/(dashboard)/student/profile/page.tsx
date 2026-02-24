"use client";

import { FormEvent, useEffect, useState } from "react";
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
  const [serverError, setServerError] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
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
      setServerError("");
      try {
        const res = await fetch("/api/auth/student-profile");
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Unable to load profile");
        }
        setProfile(data);
      } catch (error: any) {
        setServerError(error?.message || "Unable to load profile");
      } finally {
        setLoading(false);
      }
    }

    void loadProfile();
  }, []);

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError("");

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      const message = "New password and confirmation do not match";
      setServerError(message);
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
        setServerError(message);
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
      setServerError(message);
      toast.error(message);
    } finally {
      setChangingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {serverError && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-700">{serverError}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Profile</h1>
        <p className="text-muted-foreground">
          View your student account information and manage your password.
        </p>
      </div>

      {serverError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{serverError}</p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-4 text-lg font-semibold">Profile Information</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Full Name</p>
            <p className="inline-flex items-center gap-2 font-medium">
              <User className="h-4 w-4 text-muted-foreground" />
              {profile.name}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Institutional Email</p>
            <p className="inline-flex items-center gap-2 font-medium">
              <Mail className="h-4 w-4 text-muted-foreground" />
              {profile.email}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Student ID</p>
            <p className="inline-flex items-center gap-2 font-medium">
              <BadgeCheck className="h-4 w-4 text-muted-foreground" />
              {profile.studentId || "Not set"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Index Number</p>
            <p className="inline-flex items-center gap-2 font-medium">
              <BadgeCheck className="h-4 w-4 text-muted-foreground" />
              {profile.indexNumber || "Not set"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Personal Email</p>
            <p className="inline-flex items-center gap-2 font-medium">
              <Mail className="h-4 w-4 text-muted-foreground" />
              {profile.personalEmail || "Not set"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Verification Status</p>
            <p className="inline-flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              {profile.personalEmailVerifiedAt ? "Verified" : "Not verified"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Account Created</p>
            <p className="inline-flex items-center gap-2 font-medium">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              {new Date(profile.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Last Updated</p>
            <p className="inline-flex items-center gap-2 font-medium">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              {new Date(profile.updatedAt).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-4 text-lg font-semibold">Change Password</h2>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="currentPassword" className="text-sm font-medium">
              Current Password
            </label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="currentPassword"
                type={showPasswords.current ? "text" : "password"}
                value={passwordForm.currentPassword}
                onChange={(e) =>
                  setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))
                }
                required
                className="flex h-10 w-full rounded-md border border-input bg-background py-2 pl-10 pr-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <label htmlFor="newPassword" className="text-sm font-medium">
              New Password
            </label>
            <div className="relative">
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
                className="flex h-10 w-full rounded-md border border-input bg-background py-2 pl-10 pr-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              Confirm New Password
            </label>
            <div className="relative">
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
                className="flex h-10 w-full rounded-md border border-input bg-background py-2 pl-10 pr-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

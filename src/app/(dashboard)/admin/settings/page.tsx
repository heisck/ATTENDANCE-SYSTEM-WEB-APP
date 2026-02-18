import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function AdminSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).organizationId;
  if (!orgId) redirect("/login");

  const org = await db.organization.findUnique({
    where: { id: orgId },
    include: { ipRanges: true, subscription: true },
  });

  if (!org) redirect("/login");

  const settings = org.settings as any;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Configure your university&apos;s attendance system
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Organization</h2>
          <div className="mt-4 space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">Name</p>
              <p className="font-medium">{org.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Slug</p>
              <p className="font-medium">{org.slug}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Domain</p>
              <p className="font-medium">{org.domain || "Not set"}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">GPS Settings</h2>
          <div className="mt-4 space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">Campus Latitude</p>
              <p className="font-medium">{settings?.campusLat || "Not set"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Campus Longitude</p>
              <p className="font-medium">{settings?.campusLng || "Not set"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Default Radius</p>
              <p className="font-medium">
                {settings?.defaultRadiusMeters || 500}m
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                Confidence Threshold
              </p>
              <p className="font-medium">
                {settings?.confidenceThreshold || 70}%
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Trusted IP Ranges</h2>
          <div className="mt-4 space-y-2">
            {org.ipRanges.map((range) => (
              <div
                key={range.id}
                className="flex items-center justify-between rounded-md border border-border p-3"
              >
                <div>
                  <p className="font-mono text-sm">{range.cidr}</p>
                  <p className="text-xs text-muted-foreground">{range.label}</p>
                </div>
              </div>
            ))}
            {org.ipRanges.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No trusted IP ranges configured.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Subscription</h2>
          <div className="mt-4 space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">Plan</p>
              <p className="font-medium">
                {org.subscription?.plan || "FREE"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Max Students</p>
              <p className="font-medium">
                {org.subscription?.maxStudents || 100}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Max Courses</p>
              <p className="font-medium">
                {org.subscription?.maxCourses || 10}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

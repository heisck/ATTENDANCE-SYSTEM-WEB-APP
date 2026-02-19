import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user as any;

  return (
    <div className="min-h-svh bg-background md:flex md:h-svh md:overflow-hidden">
      <Sidebar role={user.role} userName={user.name || user.email || ""} />
      <main className="min-w-0 flex-1 md:overflow-y-auto">
        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}

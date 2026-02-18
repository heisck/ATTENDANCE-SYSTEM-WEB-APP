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
    <div className="flex h-screen overflow-hidden">
      <Sidebar role={user.role} userName={user.name || user.email || ""} />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}

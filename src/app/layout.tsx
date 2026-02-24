import type { Metadata } from "next";
import { Inter, Silkscreen } from "next/font/google";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
const silkscreen = Silkscreen({ weight: "400", subsets: ["latin"], variable: "--font-silkscreen" });

export const metadata: Metadata = {
  title: "AttendanceIQ",
  description: "Smart university attendance system with multi-layer security verification",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><meta name="apple-mobile-web-app-title" content="attendanceIQ" /></head>
      <body className={`${inter.className} ${silkscreen.variable}`}>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}

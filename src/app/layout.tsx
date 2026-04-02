import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { headers } from "next/headers";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import { ThemeMetaSync } from "@/components/ui/theme-meta-sync";
import "./globals.css";

const LIGHT_THEME_COLOR = "#f4f5f6";
const DARK_THEME_COLOR = "#25211e";

const THEME_META_BOOTSTRAP_SCRIPT = `
(() => {
  try {
    const storedTheme = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolvedTheme =
      storedTheme === "dark" || storedTheme === "light"
        ? storedTheme
        : prefersDark
          ? "dark"
          : "light";

    const themeColor = resolvedTheme === "dark" ? "${DARK_THEME_COLOR}" : "${LIGHT_THEME_COLOR}";

    let themeMeta = document.querySelector('meta[name="theme-color"]');
    if (!themeMeta) {
      themeMeta = document.createElement("meta");
      themeMeta.setAttribute("name", "theme-color");
      document.head.appendChild(themeMeta);
    }
    themeMeta.setAttribute("content", themeColor);

    const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (statusBarMeta) {
      statusBarMeta.setAttribute("content", resolvedTheme === "dark" ? "black-translucent" : "default");
    }
  } catch {}
})();
`;

export const metadata: Metadata = {
  title: "ATTENDANCE IQ",
  description: "Smart university attendance system with multi-layer security verification",
  manifest: "/manifest.json",
  applicationName: "ATTENDANCE IQ",
  appleWebApp: {
    capable: true,
    title: "ATTENDANCE IQ",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: LIGHT_THEME_COLOR,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RootLayoutInner>{children}</RootLayoutInner>;
}

async function RootLayoutInner({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content={LIGHT_THEME_COLOR} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_META_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <Providers nonce={nonce}>
          <ThemeMetaSync />
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}

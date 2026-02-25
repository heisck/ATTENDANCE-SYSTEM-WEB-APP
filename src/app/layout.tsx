import type { Metadata, Viewport } from "next";
import { Inter, Silkscreen, Syncopate } from "next/font/google";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import { ThemeMetaSync } from "@/components/ui/theme-meta-sync";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
const silkscreen = Silkscreen({ weight: "400", subsets: ["latin"], variable: "--font-silkscreen" });
const syncopate = Syncopate({ weight: "700", subsets: ["latin"], variable: "--font-brand" });
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
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content={LIGHT_THEME_COLOR} />
        <script dangerouslySetInnerHTML={{ __html: THEME_META_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className={`${inter.className} ${silkscreen.variable} ${syncopate.variable}`}>
        <Providers>
          <ThemeMetaSync />
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}

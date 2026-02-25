"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

const LIGHT_THEME_COLOR = "#f4f5f6";
const DARK_THEME_COLOR = "#25211e";

function setMeta(name: string, content: string) {
  let meta = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", name);
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
}

export function ThemeMetaSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!resolvedTheme) return;

    const isDark = resolvedTheme === "dark";
    setMeta("theme-color", isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
    setMeta(
      "apple-mobile-web-app-status-bar-style",
      isDark ? "black-translucent" : "default",
    );
  }, [resolvedTheme]);

  return null;
}

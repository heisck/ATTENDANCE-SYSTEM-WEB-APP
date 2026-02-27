"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "next-themes";

export function Toaster(props: ToasterProps) {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="z-[120]"
      position="top-right"
      offset={{ top: 84, right: 16, left: 16, bottom: 16 }}
      duration={3600}
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "border border-border bg-background text-foreground",
          description: "text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}

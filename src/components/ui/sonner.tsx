"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "next-themes";

export function Toaster(props: ToasterProps) {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      offset={{
        top: "calc(env(safe-area-inset-top) + 4.75rem)",
        right: 16,
        left: 16,
        bottom: 16,
      }}
      mobileOffset={{
        top: "calc(env(safe-area-inset-top) + 4.75rem)",
        right: 12,
        left: 12,
        bottom: "calc(env(safe-area-inset-bottom) + 0.75rem)",
      }}
      duration={4200}
      visibleToasts={5}
      expand
      gap={10}
      richColors
      closeButton
      containerAriaLabel="Notifications"
      toastOptions={{
        classNames: {
          toast:
            "w-full rounded-xl border border-border bg-background text-foreground shadow-lg backdrop-blur-sm",
          title: "font-semibold tracking-tight",
          content: "min-w-0",
          description: "text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}

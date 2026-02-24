"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "next-themes";

export function Toaster(props: ToasterProps) {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
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

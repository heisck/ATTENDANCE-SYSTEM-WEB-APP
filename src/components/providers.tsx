"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";

export function Providers({
  children,
  nonce,
}: Readonly<{
  children: React.ReactNode;
  nonce?: string;
}>) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      <SessionProvider>{children}</SessionProvider>
    </ThemeProvider>
  );
}

"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "@/components/ui/theme-toggle";

type AuthPageLayoutProps = {
  pageLabel: string;
  children: ReactNode;
  contentMaxWidthClass?: string;
  headerLink?: {
    href: string;
    label: string;
  };
  headerCounter?: string;
};

export function AuthPageLayout({
  pageLabel,
  children,
  contentMaxWidthClass = "max-w-3xl",
  headerLink,
  headerCounter,
}: AuthPageLayoutProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const syncViewportHeight = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      shell.style.setProperty("--auth-viewport-height", `${Math.round(viewportHeight)}px`);
    };

    const ensureFocusedFieldVisible = (event: FocusEvent) => {
      const target = event.target;
      if (
        !(target instanceof HTMLInputElement) &&
        !(target instanceof HTMLTextAreaElement) &&
        !(target instanceof HTMLSelectElement)
      ) {
        return;
      }

      window.setTimeout(() => {
        const main = mainRef.current;
        if (!main) return;

        const mainRect = main.getBoundingClientRect();
        const fieldRect = target.getBoundingClientRect();
        const topEdge = mainRect.top + 12;
        const bottomEdge = mainRect.bottom - 12;

        if (fieldRect.top < topEdge || fieldRect.bottom > bottomEdge) {
          target.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "smooth",
          });
        }
      }, 60);
    };

    syncViewportHeight();

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", syncViewportHeight);
    window.addEventListener("orientationchange", syncViewportHeight);
    visualViewport?.addEventListener("resize", syncViewportHeight);
    visualViewport?.addEventListener("scroll", syncViewportHeight);

    const main = mainRef.current;
    main?.addEventListener("focusin", ensureFocusedFieldVisible);

    const previousBodyOverflowY = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";

    return () => {
      document.body.style.overflowY = previousBodyOverflowY;

      window.removeEventListener("resize", syncViewportHeight);
      window.removeEventListener("orientationchange", syncViewportHeight);
      visualViewport?.removeEventListener("resize", syncViewportHeight);
      visualViewport?.removeEventListener("scroll", syncViewportHeight);
      main?.removeEventListener("focusin", ensureFocusedFieldVisible);
    };
  }, []);

  const shellStyle = {
    minHeight: "var(--auth-viewport-height, 100dvh)",
  } satisfies CSSProperties;

  const mainStyle = {
    height: "var(--auth-viewport-height, 100dvh)",
  } satisfies CSSProperties;

  return (
    <div ref={shellRef} className="bg-background" style={shellStyle}>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
            <Link href="/" className="inline-flex items-center">
              <Image
                src="/icon1.png"
                alt="App logo"
                width={36}
                height={36}
                className="rounded logo-mark"
              />
            </Link>

            <div className="min-w-0 px-1">
              <div className="flex min-w-0 items-center justify-center gap-1 sm:gap-2">
                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:text-sm sm:tracking-[0.16em]">
                  {pageLabel}
                </p>
                {headerCounter ? (
                  <span className="shrink-0 text-[11px] font-medium text-muted-foreground sm:text-sm">
                    {headerCounter}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 sm:gap-3">
              {headerLink ? (
                <Link
                  href={headerLink.href}
                  className="whitespace-nowrap text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:text-sm"
                >
                  {headerLink.label}
                </Link>
              ) : null}
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main
        ref={mainRef}
        className="overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] pt-[calc(4rem+env(safe-area-inset-top))] [scroll-padding-bottom:calc(env(safe-area-inset-bottom)+0.75rem)] [scroll-padding-top:calc(4rem+env(safe-area-inset-top)+0.75rem)] [-webkit-overflow-scrolling:touch]"
        style={mainStyle}
      >
        <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
          <div className={`mx-auto flex w-full min-h-0 flex-1 items-stretch ${contentMaxWidthClass}`}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

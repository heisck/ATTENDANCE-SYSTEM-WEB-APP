import Link from "next/link";
import Image from "next/image";
import { QrCode, Bluetooth, Fingerprint } from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <Image src="/icon1.png" alt="App logo" width={36} height={36} className="rounded logo-mark" />
            </div>
            <div className="flex items-center gap-4">
              <ThemeToggle />
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center justify-center rounded-md border border-border/70 bg-muted/40 px-4 py-2 text-sm font-medium text-muted-foreground opacity-60"
              >
                Sign Up
              </button>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
              >
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="pt-16">
        <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              Attendance IQ,
              <br />
              <span className="text-primary">Verified & Secure</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
              Multi-layer verification ensures every student is physically present.
              WebAuthn passkeys, rotating QR tokens, and live BLE beacon validation
              work together in real time.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
              >
                Open Portal
              </Link>
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center justify-center rounded-md border border-border/70 bg-muted/40 px-6 py-3 text-sm font-medium text-muted-foreground opacity-60"
              >
                Sign Up
              </button>
              <Link
                href="#features"
                className="inline-flex items-center justify-center rounded-md border border-border px-6 py-3 text-sm font-medium hover:bg-accent transition-colors"
              >
                Learn More
              </Link>
            </div>
          </div>
        </section>

        <section id="features" className="border-t border-border bg-muted/50">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
            <h2 className="text-center text-3xl font-bold tracking-tight">
              4 Layers of Verification
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
              Each layer eliminates a specific attack vector. Together, they make
              proxy attendance virtually impossible.
            </p>
            <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <FeatureCard
                icon={<Fingerprint className="h-8 w-8" />}
                title="WebAuthn Biometrics"
                description="Cryptographic device binding. One device per student, verified by fingerprint or face."
                score="+40 pts"
              />
              <FeatureCard
                icon={<Bluetooth className="h-8 w-8" />}
                title="BLE Proximity"
                description="Connectable attendance beacon advertises live session tokens for fast nearby verification."
                score="+30 pts"
              />
              <FeatureCard
                icon={<QrCode className="h-8 w-8" />}
                title="Rotating QR Code"
                description="HMAC-signed tokens rotate every 5 seconds. Screenshots become useless."
                score="+20 pts"
              />
              <FeatureCard
                icon={<Image src="/icon1.png" alt="" width={32} height={32} className="rounded logo-mark" />}
                title="Device Consistency"
                description="Per-device trust signals reduce spoofing by tracking stable attendance device behavior."
                score="+10 pts"
              />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-muted-foreground">
            Smart attendance for modern universities.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  score,
}: Readonly<{
  icon: React.ReactNode;
  title: string;
  description: string;
  score: string;
}>) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-primary">{icon}</div>
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
          {score}
        </span>
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

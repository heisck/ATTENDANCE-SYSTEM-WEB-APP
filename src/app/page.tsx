import Link from "next/link";
import Image from "next/image";
import { QrCode, MapPin, Fingerprint } from "lucide-react";
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
              <Link
                href="/login"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="pt-16">
        <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              University Attendance,
              <br />
              <span className="text-primary">Verified & Secure</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
              4-layer verification ensures every student is physically present.
              WebAuthn biometrics, GPS proximity, rotating QR codes, and network
              validation -- all working together.
            </p>
            <div className="mt-10 flex items-center justify-center gap-4">
              <Link
                href="/register"
                className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
              >
                Start Free Trial
              </Link>
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
                icon={<MapPin className="h-8 w-8" />}
                title="GPS Proximity"
                description="Haversine distance check ensures students are within campus radius of the session."
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
                title="Network Validation"
                description="Campus WiFi IP range verification adds contextual trust evidence."
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
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  score: string;
}) {
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

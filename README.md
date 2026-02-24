# AttendanceIQ

Smart university attendance system with 4-layer security verification. Built for multi-tenant deployment across universities.

## Security Layers

| Layer | Method | Points | Purpose |
|-------|--------|--------|---------|
| 1 | WebAuthn Biometrics | +40 | One device per student, cryptographic identity |
| 2 | GPS Proximity | +30 | Haversine distance check within campus radius |
| 3 | Rotating QR Code | +20 | HMAC-signed tokens, 5-second rotation |
| 4 | IP Validation | +10 | Campus network CIDR range check |

Confidence score (0-100) determines if attendance is flagged for review.

## Updated Security Workflow

- Student public signup is student-only (institutional email + personal email).
- Student institutional email must be exactly `@st.knust.edu.gh`.
- Lecturer onboarding is invite-only by Admin/Super Admin.
- Student personal email verification is required before attendance actions.
- Student passkey setup is required before student dashboard attendance features.
- Attendance sessions start from strict lecturer course-code validation.
- QR output includes rotating sequence labels (`E001`, `E002`, ...) and timing cues.

See [QR and Proximity Policy](docs/QR_AND_PROXIMITY_POLICY.md) for classroom scanning standards and distance guidance.

## Tech Stack

- **Next.js 16** (App Router, Server Components)
- **TypeScript** (strict mode)
- **PostgreSQL** + **Prisma ORM**
- **NextAuth.js v5** + **SimpleWebAuthn v9**
- **Tailwind CSS 4** + **Lucide Icons**

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL
docker compose up -d

# 3. Create schema and seed data
npm run db:setup

# 4. Start dev server
npm run dev
```

Open http://localhost:3000

### Seed Accounts

All accounts use password: `password123`

| Role | Email | Dashboard |
|------|-------|-----------|
| Super Admin | superadmin@attendanceiq.com | /super-admin |
| University Admin | admin@knust.edu.gh | /admin |
| Lecturer | lecturer@knust.edu.gh | /lecturer |
| Student | student1@st.knust.edu.gh | /student |

## Project Structure

```
src/
├── app/
│   ├── (auth)/           # Login, register, device setup
│   ├── (dashboard)/      # Role-based dashboards
│   │   ├── student/      # Attendance marking, history
│   │   ├── lecturer/     # Session management, QR display
│   │   ├── admin/        # Users, courses, settings
│   │   └── super-admin/  # Platform-wide analytics
│   └── api/              # REST endpoints
├── components/           # Shared UI components
├── lib/                  # Core utilities
│   ├── auth.ts           # NextAuth configuration
│   ├── webauthn.ts       # WebAuthn registration/verification
│   ├── qr.ts             # HMAC token generation
│   ├── gps.ts            # Haversine distance formula
│   ├── ip.ts             # CIDR range checking
│   └── confidence.ts     # Score calculation
├── services/             # Business logic layer
└── types/                # TypeScript definitions
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/[...nextauth]` - NextAuth sign in/out

### WebAuthn
- `GET /api/webauthn/register` - Get registration options
- `POST /api/webauthn/register` - Verify registration
- `GET /api/webauthn/authenticate` - Get auth challenge
- `POST /api/webauthn/authenticate` - Verify auth response

### Attendance
- `POST /api/attendance/sessions` - Create session (lecturer)
- `GET /api/attendance/sessions/:id` - Get session details
- `GET /api/attendance/sessions/:id/qr` - Get current QR token
- `PATCH /api/attendance/sessions/:id` - Close session
- `POST /api/attendance/mark` - Mark attendance (student)

### Public API
- `GET /api/v1/attendance` - Query records (requires x-api-key header)

### Management
- `POST /api/courses/manage` - Create course (admin)
- `POST /api/enrollments` - Enroll students
- `GET /api/reports?courseId=` - Get attendance report
- `GET /api/reports/export?courseId=&format=csv` - Export as CSV
- `POST /api/organizations/onboard` - Onboard new university

## Docker Production

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

## Vercel + Neon Deployment

See [Vercel + Neon Deployment Guide](docs/VERCEL_NEON_DEPLOY.md) for the exact production setup commands and required environment variables.

## Environment Variables

See `.env.example` for all required variables.

Add environment variables in your local project file: `.env` (project root).

### Gmail SMTP Setup

```env
GMAIL_SMTP_USER="yourgmail@gmail.com"
GMAIL_SMTP_APP_PASSWORD="your-16-char-gmail-app-password"
GMAIL_FROM_EMAIL="AttendanceIQ <yourgmail@gmail.com>"
GMAIL_SMTP_HOST="smtp.gmail.com"
GMAIL_SMTP_PORT="465"
```

Notes:
- Use a Gmail App Password (Google Account with 2FA enabled), not your normal Gmail password.
- For Docker/production, set the same keys in your deployment environment (for this repo, `docker-compose.prod.yml` already passes them into the app container).

### Supabase Production Notes

This app uses Prisma with PostgreSQL (`DATABASE_URL`/`DIRECT_URL`), not the Supabase JS client (`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`) for database reads/writes.

- `DATABASE_URL`: Use Supabase pooler URL (`:6543`) with `pgbouncer=true` and `sslmode=require`.
- `DIRECT_URL`: Use direct database host (`db.<PROJECT_REF>.supabase.co:5432`) with `sslmode=require`.
- URL-encode special characters in the DB password.
- On Render, set both vars in the service Environment tab.

### Render Auth Notes

- `AUTH_URL` must be your public Render URL (not localhost).
- `AUTH_TRUST_HOST=true` should be set behind Render's proxy.
- `AUTH_SECRET` must be set and consistent across deploys.

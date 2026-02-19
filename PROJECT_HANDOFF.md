# AttendanceIQ Project Handoff

Last updated: February 19, 2026

## 1. What We Have Built

AttendanceIQ is a multi-tenant university attendance system with layered anti-spoofing checks.

Implemented core capabilities:

- Role-based platform:
  - `SUPER_ADMIN` dashboard and analytics
  - `ADMIN` user/course/passkey management
  - `LECTURER` attendance session creation + live QR display
  - `STUDENT` multi-step attendance marking flow
- Authentication:
  - Credential login via NextAuth
  - WebAuthn passkey registration/authentication
- Attendance security pipeline (4 layers, weighted):
  - WebAuthn verification (+40)
  - GPS proximity within allowed radius (+30)
  - Rotating HMAC QR token (+20)
  - Trusted campus IP range (+10)
- Confidence scoring and automatic flagging based on org threshold.
- Multi-tenant data model with organizations, subscriptions, trusted IP ranges, courses, enrollments, sessions, records, and audit logs.
- API surface for auth, attendance, reports, org onboarding, and passkey/device management.

## 2. How It Works (End-to-End)

### 2.1 User and Org Model

- Every user can belong to an organization (`organizationId`).
- Organization settings include campus coordinates, attendance radius, and confidence threshold.
- Course and session records are scoped to organization.

### 2.2 Student Attendance Flow

1. Student logs in.
2. Student verifies passkey (WebAuthn).
3. Student shares GPS location.
4. Student scans lecturer QR.
5. Frontend posts data to `POST /api/attendance/mark`.
6. Backend validates:
   - student is enrolled
   - session is active
   - attendance not already marked
   - QR token validity (`src/lib/qr.ts`)
   - GPS radius (`src/lib/gps.ts`)
   - IP trust (`src/lib/ip.ts`)
7. Backend computes confidence (`src/lib/confidence.ts`) and flags if below threshold.
8. Attendance record is written to DB and layer-by-layer result is returned.

### 2.3 Lecturer Flow

1. Lecturer creates an attendance session with location and radius.
2. Session gets a per-session QR secret.
3. QR payload rotates every 5 seconds from a time-bucket HMAC token.
4. Students scan the payload and submit to attendance API.

### 2.4 Passkey Lock/Recovery Model

- On first successful passkey creation, account is locked for new passkey creation until admin reset.
- Admin/Super Admin can:
  - unlock passkey registration for a user
  - delete all user passkeys (and unlock them)
- Student can manage own devices and remove passkeys (but cannot delete last remaining device).

## 3. Important Files

Core:

- `src/lib/auth.ts`
- `src/lib/webauthn.ts`
- `src/lib/qr.ts`
- `src/lib/gps.ts`
- `src/lib/ip.ts`
- `src/lib/confidence.ts`
- `src/app/api/attendance/mark/route.ts`
- `prisma/schema.prisma`

UI/Feature pages:

- `src/app/(dashboard)/student/attend/page.tsx`
- `src/components/qr-scanner.tsx`
- `src/components/gps-check.tsx`
- `src/components/webauthn-prompt.tsx`
- `src/app/(dashboard)/admin/passkeys/page.tsx`
- `src/app/(dashboard)/student/devices/page.tsx`

## 4. Work Completed in This Session

### 4.1 QR Scanner Camera Preview Fix

Issue: camera overlay was visible, but live camera feed remained black on some devices.

Fix in `src/components/qr-scanner.tsx`:

- Scanner now sets scanning state first, then obtains media stream.
- Waits one animation frame before binding stream to mounted `<video>`.
- Explicitly sets `video.srcObject` and plays video with error handling.
- Proper cleanup now pauses video, clears `srcObject`, and stops tracks.

### 4.2 Responsive Dashboard Improvements

Fixes:

- Mobile sidebar drawer added with hamburger menu and backdrop:
  - `src/components/dashboard/sidebar.tsx`
- Dashboard shell changed from rigid `h-screen` to mobile-safe min-height behavior:
  - `src/app/(dashboard)/layout.tsx`
- Prevent horizontal overflow globally:
  - `src/app/globals.css` (`overflow-x-hidden`)
- Super Admin analytics organization rows made responsive (removed hard `grid-cols-5` behavior on small screens):
  - `src/app/(dashboard)/super-admin/analytics/page.tsx`

### 4.3 Mobile Input Zoom Fix

To stop phone auto-zoom on focus:

- Global form control font size forced to 16px:
  - `src/app/globals.css`
  - selectors: `input`, `select`, `textarea`

## 5. Current Status / Verification

- TypeScript check passes:
  - `npx tsc --noEmit`
- Lint script currently broken with Next 16 setup:
  - `npm run lint` returns:
    - `Invalid project directory provided ... \\lint`

## 6. Where We Stopped

We stopped after implementing:

- camera preview fix on QR scanner
- major dashboard responsiveness fixes
- 16px input font-size mobile zoom prevention

Pending continuation focus:

1. Full responsive QA pass across all dashboard pages (phone/tablet/desktop).
2. Fix lint command configuration (`next lint` behavior in this setup).
3. Final deploy pass on Render using production env vars and DB migration/seed flow.
4. Device-level verification of QR scanning on Android + iOS browsers.

## 7. Resume Checklist (Next Session)

1. Run app locally and test these routes on mobile widths:
   - `/student/attend`
   - `/student/devices`
   - `/admin/passkeys`
   - `/super-admin/analytics`
2. Replace or fix lint script in `package.json` and re-run lint.
3. Re-test camera preview + QR scanning on at least one physical device.
4. Validate Render deployment (env vars, DB push, seed, passkey origin settings).

## 8. Quick Commands

```bash
npm install
npx prisma db push
npx prisma generate
npx tsx prisma/seed.ts
npm run dev
```

Type check:

```bash
npx tsc --noEmit
```


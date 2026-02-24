# BLE Relay System - Integration Checklist

Quick checklist to integrate the relay system into your existing attendance app.

## Pre-Integration

- [ ] Review `BLE_RELAY_SUMMARY.md` (5 min overview)
- [ ] Review `BLE_RELAY_IMPLEMENTATION.md` (detailed technical)
- [ ] Have database backup ready
- [ ] Test migration locally first

## Step 1: Database (5-10 minutes)

```bash
# Generate migration from updated schema
npx prisma migrate dev --name add-ble-relay-system

# Or deploy if migration exists
npx prisma migrate deploy

# Verify tables created
npx prisma studio  # Check BleRelayDevice, RelayAttendanceRecord, RelayBroadcastState
```

**Checklist:**
- [ ] Migration runs without errors
- [ ] New tables visible in database
- [ ] No data loss in existing tables
- [ ] `AttendanceSession` has new relay fields
- [ ] `User` model has `relayDevices` relation

## Step 2: Backend (No Code Changes Needed)

All backend files are ready to use:
- [ ] `src/lib/ble-relay.ts` - Already created (520 lines)
- [ ] `src/app/api/attendance/relay/route.ts` - Already created (246 lines)

**Just verify:**
- [ ] Files exist in your project
- [ ] No import errors in IDE
- [ ] API routes show in Next.js

## Step 3: Add Student Broadcaster Component

**File to update:** `src/app/(dashboard)/student/attend/page.tsx`

**After student successfully marks attendance, add:**

```tsx
import { BleRelayBroadcaster } from "@/components/ble-relay-broadcaster";

// Inside your attendance success section:
{attendanceMarked && (
  <div className="mt-6 border-t pt-6">
    <BleRelayBroadcaster
      sessionId={session.id}
      studentId={student.id}
      qrToken={qrToken}  // From your existing mark flow
      userDeviceId={userDevice.id}  // From your device linking
      onBroadcasting={(broadcasting) => {
        // Optional: Update UI state
        console.log("Broadcasting:", broadcasting);
      }}
    />
  </div>
)}
```

**Checklist:**
- [ ] Component imports correctly
- [ ] Props passed from existing data
- [ ] No TypeScript errors
- [ ] Component renders after mark attendance
- [ ] Test in browser (see "Broadcaster" section)

## Step 4: Add Student Scanner Component (Optional)

**File to update:** `src/app/(dashboard)/student/attend/page.tsx`

**For students with bad cameras, add:**

```tsx
import { BleRelayScanner } from "@/components/ble-relay-scanner";

// Add a tab or toggle for "Scan from Friend's Device"
{showRelayOption && (
  <BleRelayScanner
    sessionId={session.id}
    onQrScanned={(qrToken, relayDeviceId, rssi) => {
      // Handle like normal QR scan
      await markAttendanceFromRelay(
        qrToken,
        relayDeviceId,
        rssi
      );
    }}
    disabled={!sessionActive}
  />
)}
```

**Checklist:**
- [ ] Component imports correctly
- [ ] Works as alternative to camera QR
- [ ] Shows only when relay enabled
- [ ] Callback handles attendance marking
- [ ] Test in browser (see "Scanner" section)

## Step 5: Add Lecturer Approval Panel

**File to update:** Your lecturer session dashboard or live monitoring page

**Add this component where lecturer monitors session:**

```tsx
import { RelayApprovalPanel } from "@/components/relay-approval-panel";

// During active session
{session.status === "ACTIVE" && (
  <RelayApprovalPanel
    sessionId={session.id}
    lecturerId={lecturer.id}
    isLive={true}  // Real-time updates
  />
)}
```

**Checklist:**
- [ ] Component imports correctly
- [ ] Shows during active sessions only
- [ ] Real-time updates working
- [ ] Approve/reject buttons functional
- [ ] Test lecturer approval flow

## Step 6: Add Admin Analytics Dashboard

**File to update:** Admin analytics or monitoring section

**Add this component to admin area:**

```tsx
import { RelayAdminDashboard } from "@/components/relay-admin-dashboard";

// In admin analytics
<div className="grid gap-6">
  {/* Existing attendance analytics */}
  
  {/* New relay analytics */}
  <RelayAdminDashboard
    sessionId={sessionId}
    lecturerId={lecturerId}
  />
</div>
```

**Checklist:**
- [ ] Component imports correctly
- [ ] Metrics display correctly
- [ ] Real-time polling working
- [ ] Charts/progress bars show
- [ ] Test with real relay data

## Step 7: Enable Relay in Session Settings

**File to update:** Your session creation or settings page

**Before/during session, allow lecturer to enable:**

```tsx
import { db } from "@/lib/db";

// Update session to enable relay
await db.attendanceSession.update({
  where: { id: sessionId },
  data: {
    relayEnabled: true,
    // Optional:
    relayAutoApprove: false,  // Manual approval (recommended)
  },
});
```

**Checklist:**
- [ ] Relay can be enabled per session
- [ ] Shows in session settings UI
- [ ] Can be toggled on/off
- [ ] Changes take effect immediately
- [ ] Test enable/disable

## Step 8: Component Display Logic

**Ensure components only show when appropriate:**

```tsx
// Broadcaster: Only after successful attendance
{attendanceStatus === "MARKED" && (
  <BleRelayBroadcaster {...props} />
)}

// Scanner: Only if relay is enabled and no direct QR yet
{sessionRelayEnabled && !qrScanned && (
  <BleRelayScanner {...props} />
)}

// Approval Panel: Only for lecturer during session
{userRole === "LECTURER" && sessionActive && relayEnabled && (
  <RelayApprovalPanel {...props} />
)}

// Dashboard: Only for admins/analytics
{userRole === "ADMIN" && (
  <RelayAdminDashboard {...props} />
)}
```

**Checklist:**
- [ ] Components only show to correct users
- [ ] No duplicate elements
- [ ] Proper conditional rendering
- [ ] Test all user flows

## Step 9: Testing

### Browser Testing

- [ ] Chrome/Edge (full Web Bluetooth support)
- [ ] Safari 15+ (partial support)
- [ ] Mobile devices (primary use case)
- [ ] HTTPS enabled (required for Web Bluetooth)

**Checklist:**
- [ ] Broadcaster works in your browsers
- [ ] Scanner works in your browsers
- [ ] Approval panel works
- [ ] Dashboard loads and updates
- [ ] No console errors

### Flow Testing

**Student with working camera:**
1. [ ] Marks attendance normally
2. [ ] Sees broadcaster option
3. [ ] Device registers (PENDING)
4. [ ] Waits for lecturer approval

**Lecturer:**
1. [ ] Sees pending devices
2. [ ] Can approve device
3. [ ] Can reject device
4. [ ] Can revoke approved device

**Student with bad camera:**
1. [ ] Sees scanner option
2. [ ] Selects friend's device
3. [ ] BLE scan works
4. [ ] Attendance recorded with relay ref

**Admin:**
1. [ ] Dashboard loads
2. [ ] Stats show relay info
3. [ ] Updates in real-time
4. [ ] Insights display correctly

## Step 10: Deployment

### Before Deploy

- [ ] All code changes tested locally
- [ ] Migration tested locally
- [ ] No console errors in dev mode
- [ ] Database backup completed
- [ ] Rollback plan documented

### Deploy to Staging

```bash
# 1. Run migration
npx prisma migrate deploy

# 2. Deploy code
git push origin staging
# (your CI/CD deploys it)

# 3. Test on staging
# Run through all flows
```

- [ ] Migration succeeds in staging
- [ ] Components load
- [ ] API calls work
- [ ] No database errors

### Deploy to Production

```bash
# Same process to prod
git push origin main
# (your CI/CD deploys it)
```

- [ ] Migration succeeds
- [ ] No downtime
- [ ] Monitor logs for errors
- [ ] Verify in live session

## Post-Deployment

- [ ] Monitor error logs for relay API errors
- [ ] Track relay adoption metrics
- [ ] Gather user feedback
- [ ] Monitor database growth
- [ ] Test on real devices during live session

## Verification Tests

Run these checks to confirm everything works:

```bash
# 1. Check tables exist
npx prisma studio
# Look for: BleRelayDevice, RelayAttendanceRecord, RelayBroadcastState

# 2. Check API route exists
curl http://localhost:3000/api/attendance/relay?sessionId=test

# 3. Check components import
npm run build
# Should have no import errors

# 4. Test in browser
# Load student attend page
# See broadcaster component renders
# Test approval panel as lecturer
```

**All passing?** You're ready for live testing!

## Troubleshooting

### Database Migration Failed

```
Error: Migration failed
→ Check: Do you have existing code using new field names?
→ Check: Is database locked? Try closing other connections
→ Solution: Drop migration and recreate
npx prisma migrate reset --force
npx prisma migrate dev --name add-ble-relay-system
```

### Components Not Rendering

```
Error: BleRelayBroadcaster is not exported
→ Check: File exists at src/components/ble-relay-broadcaster.tsx
→ Check: Import statement is correct
→ Check: No TypeScript errors
```

### API Returns 401

```
Error: API returns 401 Unauthorized
→ Check: User is logged in
→ Check: Session/auth is working
→ Check: User has correct role (student/lecturer)
```

### Web Bluetooth Not Working

```
Error: "Web Bluetooth not supported"
→ Check: Using HTTPS (required)
→ Check: Using Chrome/Edge/Safari 15+ (Firefox not supported)
→ Check: Bluetooth enabled on device
→ Check: User approves permission popup
```

## Rollback (If Needed)

```bash
# Undo migration
npx prisma migrate resolve --rolled-back add-ble-relay-system

# Or manually
# 1. Revert code changes
# 2. Remove new components
# 3. Restore old files

# System is back to pre-relay state
```

---

## Success Criteria

You'll know it's working when:

- ✅ Students see broadcaster after marking attendance
- ✅ Broadcaster shows device registration pending
- ✅ Lecturer can approve/reject devices
- ✅ Friends can scan QR from relay
- ✅ Attendance recorded with relay reference
- ✅ Admin dashboard shows relay stats
- ✅ No errors in logs
- ✅ All users can complete their workflows

---

## Timeline

**Estimated integration time:**
- Step 1-2 (Database): 5-10 minutes
- Step 3-6 (Components): 20-30 minutes
- Step 7-8 (Logic): 15-20 minutes
- Step 9 (Testing): 30-60 minutes
- Step 10 (Deployment): 10-20 minutes

**Total: 1.5-2 hours for experienced developer**

---

## Support Contacts

- **Technical questions**: See `BLE_RELAY_IMPLEMENTATION.md`
- **Integration help**: Check files created and their docstrings
- **Debugging**: Enable console.log in components, check network tab
- **Database issues**: Check migration logs, verify schema changes

---

**You're all set! Start with Step 1 and work through the checklist. 🚀**

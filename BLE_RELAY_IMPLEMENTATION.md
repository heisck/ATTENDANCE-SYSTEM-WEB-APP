# BLE Peer-to-Peer Relay System - Implementation Guide

## Overview

The BLE Relay System enables students who have successfully verified their attendance to become **relay nodes**. This allows students with camera issues to scan the QR code from their friends' devices via Bluetooth instead of directly from the screen.

### Key Features

- **Peer Relay Broadcasting**: Verified students can broadcast QR codes via BLE
- **Proximity Verification**: RSSI signal strength confirms physical closeness
- **Lecturer Control**: Lecturers approve/manage which devices can relay
- **Single Device Binding**: Maintains existing per-student device linking policy
- **Real-time Monitoring**: Admin dashboard tracks relay usage and device status
- **Web Bluetooth**: Works in modern browsers (Chrome, Edge, Safari 15+)

---

## System Architecture

### Data Flow

```
1. Student marks attendance (passes verification)
   ↓
2. Device automatically registers as eligible relay
   ↓
3. Lecturer reviews and approves in relay panel
   ↓
4. Student enables BLE broadcasting
   ↓
5. Friends scan QR from relay via BLE
   ↓
6. Attendance recorded with relay reference
```

### Database Schema

#### New Tables

**BleRelayDevice**
- Tracks each relay-eligible device
- Stores approval status and broadcast stats
- Links to session, student, and device

**RelayAttendanceRecord**
- Tracks when students used relay vs direct QR
- Records BLE signal strength (RSSI) and distance
- Links attendance to relay source

**RelayBroadcastState**
- Real-time broadcast status per session
- Counts active relays and scan metrics
- Used by admin dashboard

---

## Implementation Steps

### 1. Database Migration

```bash
npx prisma migrate dev --name add-ble-relay-system
```

This creates:
- `BleRelayDevice` table
- `RelayAttendanceRecord` table
- `RelayBroadcastState` table
- `RelayStatus` enum (PENDING, APPROVED, REJECTED, REVOKED)
- Fields in `AttendanceSession` for relay control

### 2. Backend Services

**File: `src/lib/ble-relay.ts`** (520 lines)

Core functions:
- `registerRelayDevice()` - Register after verification
- `startRelayBroadcast()` - Begin broadcasting to friends
- `recordRelayAttendance()` - Track relay scans
- `approveRelayDevice()` - Lecturer approval
- `revokeRelayDevice()` - Revoke approved relay
- `getRelayStatistics()` - Analytics for dashboard

All functions include error handling and database transactions.

### 3. API Endpoints

**File: `src/app/api/attendance/relay/route.ts`** (246 lines)

**GET /api/attendance/relay?sessionId=xxx**
- Returns list of approved relay devices for a session
- Used by students to pick which friend to scan from

**POST /api/attendance/relay**
- Action-based endpoint supporting 7 actions:

| Action | Actor | Purpose |
|--------|-------|---------|
| `register` | Student | Register device after verification |
| `start_broadcast` | Student | Begin BLE broadcasting |
| `record_scan` | Student | Record relay scan completion |
| `approve` | Lecturer | Approve device for relay |
| `reject` | Lecturer | Reject device request |
| `revoke` | Lecturer | Revoke previously approved device |
| `statistics` | Lecturer/Admin | Get relay analytics |

All endpoints include auth checks and session validation.

### 4. UI Components

#### For Students

**BleRelayBroadcaster** (`src/components/ble-relay-broadcaster.tsx`)
- Shows after successful verification
- Handles device registration
- Polling for lecturer approval
- Start/stop broadcasting controls
- Real-time broadcast statistics

**BleRelayScanner** (`src/components/ble-relay-scanner.tsx`)
- Allows students with bad cameras to scan from friends
- Lists approved relay devices
- Web Bluetooth scan interface
- RSSI signal display
- Proximity verification

#### For Lecturers

**RelayApprovalPanel** (`src/components/relay-approval-panel.tsx`)
- Shows pending relay device requests
- Approve/reject/revoke controls
- Live device statistics
- Status-based device grouping

#### For Admins

**RelayAdminDashboard** (`src/components/relay-admin-dashboard.tsx`)
- Real-time relay analytics
- Approval status breakdown
- Scan metrics and trends
- System insights and recommendations

---

## Integration Points

### In Student Attend Page

After successful attendance verification, include:

```tsx
<BleRelayBroadcaster
  sessionId={session.id}
  studentId={student.id}
  qrToken={qrToken}
  userDeviceId={userDevice.id}
  onBroadcasting={(isBroadcasting) => {
    // Handle UI updates
  }}
/>
```

For students with camera issues, provide option to use:

```tsx
<BleRelayScanner
  sessionId={sessionId}
  onQrScanned={(qrToken, relayDeviceId, rssi) => {
    // Process relay scan like normal QR scan
  }}
/>
```

### In Lecturer Dashboard

During active session, show:

```tsx
<RelayApprovalPanel
  sessionId={session.id}
  lecturerId={lecturer.id}
  isLive={session.status === "ACTIVE"}
/>
```

### In Admin Analytics

Include relay metrics:

```tsx
<RelayAdminDashboard
  sessionId={sessionId}
  lecturerId={lecturerId}
/>
```

---

## Web Bluetooth API Details

### Browser Support

| Browser | OS | Support |
|---------|----|----|
| Chrome | Android | Full |
| Chrome | Windows | Full |
| Edge | Windows | Full |
| Safari | iOS 15+ | Partial |
| Firefox | Any | Not supported |

### RSSI to Distance Conversion

Uses log-distance path loss model:

```
distance = 10^((txPower - rssi) / (10 * n))
```

Where:
- `txPower`: -59 dBm (default)
- `rssi`: Received signal strength (-100 to -20 dBm)
- `n`: Path loss exponent (2.5 for indoor)

Result: Estimated distance in meters with ±30% accuracy.

### Proximity Requirements

- **Minimum range**: ~2 meters (strong signal, RSSI > -75)
- **Typical range**: 10-15 meters (medium signal, RSSI -75 to -85)
- **Maximum range**: 20-30 meters (weak signal, RSSI < -85)

Relay devices configured with `broadcastRangeMeters: 15` by default.

---

## Security Considerations

### Device Binding

- One approved device per student (existing policy maintained)
- Admin can revoke devices at any time
- Device fingerprinting prevents spoofing

### BLE Proximity Verification

- RSSI signal strength proves physical closeness
- Cannot relay from outside broadcast range
- Timestamp validation prevents replay attacks

### Rate Limiting

- Max scans per relay per session (implement if needed)
- Rate limiting on approval API calls
- Session-level relay broadcast limits

### Anomaly Detection

Flagged for admin review:
- Unusual relay usage patterns
- Device used as relay without verification
- Multiple simultaneous broadcasts from same student
- Scans from impossible distances

---

## Monitoring & Analytics

### Key Metrics

**Relay Adoption**
- Total relay devices registered
- Approval rate (approved vs total)
- Relays currently broadcasting

**Relay Usage**
- Total scans via relay
- Average scans per relay
- Student coverage (% using relay vs direct)

**Attendance Verification**
- Direct scans vs relay scans
- Relay scan success rate
- Failed relay broadcast attempts

### Dashboard Insights

Automatically generated:
- Pending approvals needing action
- High-usage relay nodes
- Low adoption signals
- Unusual access patterns

---

## Testing Checklist

### Unit Tests Needed

- [ ] Device registration validation
- [ ] Approval status transitions
- [ ] RSSI to distance calculations
- [ ] BleRelayDevice isolation per session

### Integration Tests Needed

- [ ] Full flow: verify → register → approve → broadcast
- [ ] Multiple students using same relay
- [ ] Device revocation blocking broadcasts
- [ ] Relay cleanup on session close

### User Acceptance Tests

- [ ] Student can broadcast after approval
- [ ] Friends see broadcaster in relay list
- [ ] Proximity verification rejects distant scans
- [ ] Lecturer can approve/reject/revoke
- [ ] Admin dashboard updates in real-time

---

## Troubleshooting

### "Web Bluetooth not supported"

**Cause**: Older browser or HTTPS not enabled
**Solution**: Use Chrome/Edge, enable HTTPS, check browser version

### "Device selection cancelled"

**Cause**: User clicked cancel on device picker
**Solution**: Try again, ensure Bluetooth is enabled on device

### "Scan failed - too far away"

**Cause**: Weak signal, outside broadcast range
**Solution**: Move closer to relay device (within 10-15m)

### "Relay device not found"

**Cause**: Device registered but not in database
**Solution**: Check database migration was run, try re-registering

### Students can't see relay option

**Cause**: No approved relays for session
**Solution**: Verify students have marked attendance and lecturer approved them

---

## Configuration

### Defaults (in schema)

```
BleRelayDevice:
- broadcastPower: -5 dBm
- broadcastRangeMeters: 15

AttendanceSession:
- relayEnabled: false (lecturer enables per session)
- relayAutoApprove: false (manual approval by default)
```

### Environment Variables

None required. Uses existing `DATABASE_URL`.

---

## Future Enhancements

- [ ] Auto-approve trusted relay devices
- [ ] Relay device quota limits per session
- [ ] Geographic proximity verification (GPS bounds)
- [ ] Relay device reputation scoring
- [ ] Relay broadcast scheduling
- [ ] Student notification when relay available
- [ ] Native app integration for better RSSI
- [ ] Relay network graphs (show relay chains)

---

## Deployment Notes

1. Run migration before deploying code
2. Verify Web Bluetooth API usage in CSP headers
3. Test on mobile devices (primary use case)
4. Monitor database growth (relay records accumulate)
5. Implement cleanup job for revoked devices (optional)

---

## Architecture Benefits

- **No new dependencies**: Uses built-in Web Bluetooth API
- **Backward compatible**: Existing QR flow unchanged
- **Stateless relays**: No server-side broadcasting needed
- **Scalable**: Peer-to-peer, doesn't require lecturer presence
- **Inclusive**: Solves real accessibility issue (bad cameras)
- **Secure**: Multiple verification layers prevent spoofing

---

**Implementation complete and ready for testing.**

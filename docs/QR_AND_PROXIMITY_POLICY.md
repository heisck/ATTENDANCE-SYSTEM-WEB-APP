# AttendanceIQ QR and Proximity Policy

## Why this policy exists
This policy defines a clear, enforceable classroom standard for QR visibility and scan timing so students can reliably scan in-person and cannot claim they "didn't see the code."

## QR display standard
- QR format: SVG high-contrast dark-on-white.
- Quiet zone: at least 4 modules.
- Rotation: every 5 seconds.
- Scan validity: server accepts scans only within an 8-second scan-time tolerance window.
- Sequence labels: each QR has a visible ID (`E001`, `E002`, ...).
- Cue marker: each QR includes a colored center dot plus cue text.
- Fullscreen mode: lecturer screen should use fullscreen during live attendance.
- Brightness mode: lecturer can enable brightness/contrast boost.

## Student scan guidance
- Students must scan the currently displayed sequence ID (example: "Scan E333 now").
- UI also shows the next sequence so students can anticipate rotation.
- Scanner includes zoom controls:
  - Native camera zoom where browser/device supports it.
  - Digital zoom fallback where native zoom is unavailable.

## Practical classroom distance rule (A4 QR target)
- Reliable target distance: up to 10 meters.
- Conditional range: 10 to 12 meters (depends on camera, lighting, zoom quality).
- Not supported as reliable: beyond 12 meters for mixed Android+iPhone fleets.

## Room-size guidance
- If room depth is greater than 10 meters, increase effective QR size (projected/displayed equivalent of 40-60 cm square).
- Keep screen brightness high and avoid low-contrast color themes.

## Security and anti-sharing rule
- QR sharing/redistribution between students is not allowed.
- Browser-based screenshot/screen-record blocking is not reliable across devices.
- Security relies on short QR rotation, passkey, GPS, and IP confidence checks.

## BLE/Web proximity note
- Web Bluetooth support is inconsistent across browsers and iOS workflows.
- BLE is treated as experimental capability only, not a primary attendance proof.
- Attendance integrity remains anchored to passkey + GPS + rotating QR + network context.

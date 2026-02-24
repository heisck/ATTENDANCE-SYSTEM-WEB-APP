/**
 * Professional HTML email templates for transactional emails.
 * Uses inline styles for maximum email client compatibility.
 */

const BRAND_COLOR = "#1e3a5f";
const BUTTON_COLOR = "#2563eb";
const TEXT_COLOR = "#1f2937";
const MUTED_COLOR = "#6b7280";
const BORDER_COLOR = "#e5e7eb";

function baseLayout(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AttendanceIQ</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6; color: ${TEXT_COLOR}; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, ${BRAND_COLOR} 0%, #2d4a6f 100%); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">
                AttendanceIQ
              </h1>
              <p style="margin: 6px 0 0 0; font-size: 13px; color: rgba(255,255,255,0.85);">
                Smart attendance for modern universities
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; background-color: #f9fafb; border-top: 1px solid ${BORDER_COLOR};">
              <p style="margin: 0; font-size: 12px; color: ${MUTED_COLOR}; text-align: center;">
                This email was sent by AttendanceIQ. If you didn&apos;t request this, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();
}

function ctaButton(href: string, label: string): string {
  return `
<a href="${href}" style="display: inline-block; margin: 24px 0 0 0; padding: 14px 28px; background-color: ${BUTTON_COLOR}; color: #ffffff !important; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.3);">
  ${label}
</a>
`.trim();
}

export function verificationEmailHtml(params: {
  recipientName: string;
  verifyUrl: string;
  expiresAt: Date;
  context?: "register" | "profile" | "resend";
}): string {
  const { recipientName, verifyUrl, expiresAt, context = "register" } = params;
  const greeting =
    context === "register"
      ? "Verify your personal email to activate attendance features and complete your account setup."
      : context === "profile"
        ? "You updated your personal email. Click below to verify the new address."
        : "Use the link below to verify your personal email.";

  const content = `
<p style="margin: 0 0 16px 0; font-size: 16px; color: ${TEXT_COLOR};">
  Hello ${recipientName},
</p>
<p style="margin: 0 0 20px 0; font-size: 15px; color: ${MUTED_COLOR};">
  ${greeting}
</p>
<p style="margin: 0 0 8px 0; font-size: 14px; color: ${MUTED_COLOR};">
  This link expires on <strong style="color: ${TEXT_COLOR};">${expiresAt.toUTCString()}</strong>.
</p>
<div style="text-align: center; margin: 28px 0 0 0;">
  ${ctaButton(verifyUrl, "Verify email")}
</div>
<p style="margin: 28px 0 0 0; font-size: 13px; color: ${MUTED_COLOR};">
  If the button doesn&apos;t work, copy and paste this link into your browser:
</p>
<p style="margin: 8px 0 0 0; font-size: 13px; word-break: break-all;">
  <a href="${verifyUrl}" style="color: ${BUTTON_COLOR}; text-decoration: underline;">${verifyUrl}</a>
</p>
`.trim();

  return baseLayout(content);
}

export function passwordResetEmailHtml(params: {
  recipientName: string;
  resetUrl: string;
  expiresAt: Date;
}): string {
  const { recipientName, resetUrl, expiresAt } = params;

  const content = `
<p style="margin: 0 0 16px 0; font-size: 16px; color: ${TEXT_COLOR};">
  Hello ${recipientName},
</p>
<p style="margin: 0 0 20px 0; font-size: 15px; color: ${MUTED_COLOR};">
  We received a request to reset your AttendanceIQ password. Click the button below to choose a new password.
</p>
<p style="margin: 0 0 8px 0; font-size: 14px; color: ${MUTED_COLOR};">
  This link expires on <strong style="color: ${TEXT_COLOR};">${expiresAt.toUTCString()}</strong>.
</p>
<div style="text-align: center; margin: 28px 0 0 0;">
  ${ctaButton(resetUrl, "Reset password")}
</div>
<p style="margin: 28px 0 0 0; font-size: 13px; color: ${MUTED_COLOR};">
  If you didn&apos;t request a password reset, you can safely ignore this email. Your password will remain unchanged.
</p>
<p style="margin: 16px 0 0 0; font-size: 13px; color: ${MUTED_COLOR};">
  If the button doesn&apos;t work, copy and paste this link into your browser:
</p>
<p style="margin: 8px 0 0 0; font-size: 13px; word-break: break-all;">
  <a href="${resetUrl}" style="color: ${BUTTON_COLOR}; text-decoration: underline;">${resetUrl}</a>
</p>
`.trim();

  return baseLayout(content);
}

export function lecturerInviteEmailHtml(params: {
  organizationName: string;
  acceptUrl: string;
  expiresAt: Date;
  isResend?: boolean;
}): string {
  const { organizationName, acceptUrl, expiresAt, isResend } = params;

  const content = `
<p style="margin: 0 0 16px 0; font-size: 16px; color: ${TEXT_COLOR};">
  ${isResend ? "Your lecturer invite has been refreshed." : "You have been invited to join AttendanceIQ as a lecturer."}
</p>
<p style="margin: 0 0 20px 0; font-size: 15px; color: ${MUTED_COLOR};">
  ${isResend ? "Use the link below to accept your updated invite." : `You&apos;ve been invited by <strong style="color: ${TEXT_COLOR};">${organizationName}</strong>. Click below to create your lecturer account and get started.`}
</p>
<p style="margin: 0 0 8px 0; font-size: 14px; color: ${MUTED_COLOR};">
  This invite expires on <strong style="color: ${TEXT_COLOR};">${expiresAt.toUTCString()}</strong>.
</p>
<div style="text-align: center; margin: 28px 0 0 0;">
  ${ctaButton(acceptUrl, "Accept invite")}
</div>
<p style="margin: 28px 0 0 0; font-size: 13px; color: ${MUTED_COLOR};">
  If the button doesn&apos;t work, copy and paste this link into your browser:
</p>
<p style="margin: 8px 0 0 0; font-size: 13px; word-break: break-all;">
  <a href="${acceptUrl}" style="color: ${BUTTON_COLOR}; text-decoration: underline;">${acceptUrl}</a>
</p>
`.trim();

  return baseLayout(content);
}

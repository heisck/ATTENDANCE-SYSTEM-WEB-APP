/**
 * Professional HTML email templates for transactional emails.
 * Uses inline styles for maximum email client compatibility.
 */

const APP_NAME = "ATTENDANCE IQ";
const APP_TAGLINE = "Smart attendance for modern universities";
const LOGO_SRC = "cid:attendance-iq-logo";

const BG_COLOR = "#f6f7f9";
const CARD_COLOR = "#ffffff";
const TEXT_COLOR = "#0f172a";
const MUTED_COLOR = "#64748b";
const BORDER_COLOR = "#e2e8f0";
const BUTTON_COLOR = "#111827";
const BUTTON_TEXT = "#ffffff";

function brandHeaderHtml(): string {
  const logo = `<img src="${LOGO_SRC}" width="42" height="42" alt="${APP_NAME} logo" style="display: block; width: 42px; height: 42px; border-radius: 9px; margin: 0 auto 12px auto;" />`;

  return `
${logo}
<h1 style="margin: 0; font-size: 18px; font-weight: 700; color: ${TEXT_COLOR}; letter-spacing: 0.01em;">
  ${APP_NAME}
</h1>
<p style="margin: 6px 0 0 0; font-size: 12px; color: ${MUTED_COLOR};">
  ${APP_TAGLINE}
</p>
`.trim();
}

function baseLayout(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${APP_NAME}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: ${BG_COLOR}; color: ${TEXT_COLOR}; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: ${BG_COLOR}; padding: 36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: ${CARD_COLOR}; border-radius: 16px; border: 1px solid ${BORDER_COLOR}; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08); overflow: hidden;">
          <tr>
            <td style="padding: 24px 30px 18px 30px; text-align: center; border-bottom: 1px solid ${BORDER_COLOR};">
              ${brandHeaderHtml()}
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 30px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding: 18px 24px; background-color: #fafafa; border-top: 1px solid ${BORDER_COLOR};">
              <p style="margin: 0; font-size: 12px; color: ${MUTED_COLOR}; text-align: center;">
                This email was sent by ${APP_NAME}. If you didn&apos;t request this, you can safely ignore it.
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
<a href="${href}" style="display: inline-block; margin: 24px 0 0 0; padding: 12px 22px; background-color: ${BUTTON_COLOR}; color: ${BUTTON_TEXT} !important; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 10px;">
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
<p style="margin: 0 0 18px 0; font-size: 15px; color: ${MUTED_COLOR};">
  ${greeting}
</p>
<p style="margin: 0 0 8px 0; font-size: 13px; color: ${MUTED_COLOR};">
  This link expires on <strong style="color: ${TEXT_COLOR};">${expiresAt.toUTCString()}</strong>.
</p>
<div style="text-align: center; margin: 28px 0 0 0;">
  ${ctaButton(verifyUrl, "Verify email")}
</div>
<p style="margin: 24px 0 0 0; font-size: 12px; color: ${MUTED_COLOR};">
  If the button doesn&apos;t work, copy and paste this link into your browser:
</p>
<p style="margin: 8px 0 0 0; font-size: 12px; word-break: break-all;">
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
<p style="margin: 0 0 18px 0; font-size: 15px; color: ${MUTED_COLOR};">
  We received a request to reset your ATTENDANCE IQ password. Click the button below to choose a new password.
</p>
<p style="margin: 0 0 8px 0; font-size: 13px; color: ${MUTED_COLOR};">
  This link expires on <strong style="color: ${TEXT_COLOR};">${expiresAt.toUTCString()}</strong>.
</p>
<div style="text-align: center; margin: 28px 0 0 0;">
  ${ctaButton(resetUrl, "Reset password")}
</div>
<p style="margin: 24px 0 0 0; font-size: 12px; color: ${MUTED_COLOR};">
  If you didn&apos;t request a password reset, you can safely ignore this email. Your password will remain unchanged.
</p>
<p style="margin: 14px 0 0 0; font-size: 12px; color: ${MUTED_COLOR};">
  If the button doesn&apos;t work, copy and paste this link into your browser:
</p>
<p style="margin: 8px 0 0 0; font-size: 12px; word-break: break-all;">
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
  ${isResend ? "Your lecturer invite has been refreshed." : "You have been invited to join ATTENDANCE IQ as a lecturer."}
</p>
<p style="margin: 0 0 18px 0; font-size: 15px; color: ${MUTED_COLOR};">
  ${isResend ? "Use the link below to accept your updated invite." : `You&apos;ve been invited by <strong style="color: ${TEXT_COLOR};">${organizationName}</strong>. Click below to create your lecturer account and get started.`}
</p>
<p style="margin: 0 0 8px 0; font-size: 13px; color: ${MUTED_COLOR};">
  This invite expires on <strong style="color: ${TEXT_COLOR};">${expiresAt.toUTCString()}</strong>.
</p>
<div style="text-align: center; margin: 28px 0 0 0;">
  ${ctaButton(acceptUrl, "Accept invite")}
</div>
<p style="margin: 24px 0 0 0; font-size: 12px; color: ${MUTED_COLOR};">
  If the button doesn&apos;t work, copy and paste this link into your browser:
</p>
<p style="margin: 8px 0 0 0; font-size: 12px; word-break: break-all;">
  <a href="${acceptUrl}" style="color: ${BUTTON_COLOR}; text-decoration: underline;">${acceptUrl}</a>
</p>
`.trim();

  return baseLayout(content);
}

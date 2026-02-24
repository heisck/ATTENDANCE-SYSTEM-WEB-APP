type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

const GMAIL_SMTP_HOST = process.env.GMAIL_SMTP_HOST || "smtp.gmail.com";
const GMAIL_SMTP_PORT = Number(process.env.GMAIL_SMTP_PORT || 465);
const GMAIL_SMTP_SECURE = GMAIL_SMTP_PORT === 465;

let cachedTransporter:
  | {
      sendMail: (options: {
        from: string;
        to: string;
        subject: string;
        html: string;
        text?: string;
      }) => Promise<unknown>;
    }
  | null = null;

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || "http://localhost:3000";
}

export function buildAppUrl(path: string): string {
  return `${getAppUrl().replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function getGmailConfig() {
  const user = process.env.GMAIL_SMTP_USER?.trim() || "";
  const pass = process.env.GMAIL_SMTP_APP_PASSWORD?.trim() || "";
  const from = process.env.GMAIL_FROM_EMAIL?.trim() || (user ? `AttendanceIQ <${user}>` : "");
  return { user, pass, from };
}

function getTransporter(user: string, pass: string) {
  if (!cachedTransporter) {
    // Intentionally using require to avoid type coupling on optional package typings.
    const nodemailer = require("nodemailer");
    cachedTransporter = nodemailer.createTransport({
      host: GMAIL_SMTP_HOST,
      port: GMAIL_SMTP_PORT,
      secure: GMAIL_SMTP_SECURE,
      auth: { user, pass },
    });
  }

  return cachedTransporter!;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const { user, pass, from } = getGmailConfig();

  if (!user || !pass || !from) {
    // Keep local/dev flow operational even without SMTP credentials.
    console.warn("[email] Gmail SMTP vars are missing; skipping outbound email.", {
      to: input.to,
      subject: input.subject,
    });
    return;
  }

  const transporter = getTransporter(user, pass);
  await transporter.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
}

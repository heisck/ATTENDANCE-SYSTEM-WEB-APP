type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    cid?: string;
    contentType?: string;
  }>;
};

type MailAttachment = {
  filename: string;
  content: Buffer | string;
  cid?: string;
  contentType?: string;
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
        attachments?: MailAttachment[];
      }) => Promise<unknown>;
    }
  | null = null;
let hasLoggedGmailAuthHint = false;
let cachedBrandLogo:
  | {
      filename: string;
      content: Buffer;
      cid: string;
      contentType: string;
    }
  | null
  | undefined = undefined;

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || "http://localhost:3000";
}

export function buildAppUrl(path: string): string {
  return `${getAppUrl().replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function getGmailConfig() {
  const user = process.env.GMAIL_SMTP_USER?.trim() || "";
  // Gmail app passwords are often copied with spaces every 4 chars; normalize them.
  const pass = process.env.GMAIL_SMTP_APP_PASSWORD?.replace(/\s+/g, "").trim() || "";
  const from = process.env.GMAIL_FROM_EMAIL?.trim() || (user ? `ATTENDANCE IQ <${user}>` : "");
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

async function getBrandLogoAttachment() {
  if (cachedBrandLogo !== undefined) {
    return cachedBrandLogo;
  }

  try {
    const fs = require("node:fs/promises");
    const path = require("node:path");
    const logoPath = path.join(process.cwd(), "public", "web-app-manifest-192x192.png");
    const content = await fs.readFile(logoPath);

    cachedBrandLogo = {
      filename: "attendance-iq-logo.png",
      content,
      cid: "attendance-iq-logo",
      contentType: "image/png",
    };
    return cachedBrandLogo;
  } catch {
    cachedBrandLogo = null;
    return null;
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isPermanentAuthFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; responseCode?: number };
  return candidate.code === "EAUTH" || candidate.responseCode === 535;
}

export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const { user, pass, from } = getGmailConfig();

  if (!user || !pass || !from) {
    // Keep local/dev flow operational even without SMTP credentials.
    console.warn("[email] Gmail SMTP vars are missing; skipping outbound email.", {
      to: input.to,
      subject: input.subject,
    });
    return false;
  }

  const brandLogo = await getBrandLogoAttachment();
  const hasLogoCid = (input.attachments || []).some(
    (attachment) => attachment.cid === "attendance-iq-logo"
  );

  const attachments = [
    ...(input.attachments || []),
    ...(brandLogo && !hasLogoCid ? [brandLogo] : []),
  ];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const transporter = getTransporter(user, pass);
      await transporter.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments,
      });
      return true;
    } catch (error) {
      const permanentAuthFailure = isPermanentAuthFailure(error);
      console.error(`[email] send attempt ${attempt} failed`, {
        to: input.to,
        subject: input.subject,
        permanentAuthFailure,
        error,
      });
      if (permanentAuthFailure) {
        if (!hasLoggedGmailAuthHint) {
          console.error(
            "[email] Gmail authentication failed permanently. Verify GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD."
          );
          hasLoggedGmailAuthHint = true;
        }
      }
      cachedTransporter = null;
      if (attempt < 2 && !permanentAuthFailure) {
        await sleep(350);
      }
      if (permanentAuthFailure) break;
    }
  }

  return false;
}

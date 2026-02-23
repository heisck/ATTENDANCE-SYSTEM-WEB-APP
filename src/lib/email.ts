type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

const RESEND_API_URL = "https://api.resend.com/emails";

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || "http://localhost:3000";
}

export function buildAppUrl(path: string): string {
  return `${getAppUrl().replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "AttendanceIQ <no-reply@attendanceiq.local>";

  if (!apiKey) {
    // Keep local/dev flow operational even without a provider key.
    console.warn("[email] RESEND_API_KEY is missing; skipping outbound email.", {
      to: input.to,
      subject: input.subject,
    });
    return;
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Email send failed (${response.status}): ${body}`);
  }
}

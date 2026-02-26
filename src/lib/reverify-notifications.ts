import webpush from "web-push";
import { db } from "@/lib/db";
import { formatQrSequenceId } from "@/lib/qr";

type ReverifyNotificationReason =
  | "INITIAL_SELECTION"
  | "AUTO_RETRY"
  | "MANUAL_RETRY"
  | "LECTURER_TARGET";

type ReverifySlotNotificationInput = {
  studentId: string;
  sessionId: string;
  sequence: number;
  slotStartsAt: Date;
  slotEndsAt: Date;
  attemptCount: number;
  retryCount: number;
  batchNumber?: number;
  totalBatches?: number;
  reason: ReverifyNotificationReason;
};

type PushPayload = {
  title: string;
  body: string;
  data: {
    url: string;
    sessionId: string;
    sequenceId: string;
    slotStartsAt: string;
    slotEndsAt: string;
  };
};

let pushConfigured: boolean | null = null;

function ensurePushConfigured(): boolean {
  if (pushConfigured !== null) return pushConfigured;

  const publicKey =
    process.env.WEB_PUSH_PUBLIC_KEY || process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT || "mailto:no-reply@attendanceiq.app";

  if (!publicKey || !privateKey) {
    pushConfigured = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  pushConfigured = true;
  return true;
}

async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensurePushConfigured()) return;

  const subscriptions = await db.pushSubscription.findMany({
    where: { userId },
    select: {
      id: true,
      endpoint: true,
      p256dh: true,
      auth: true,
    },
  });

  if (subscriptions.length === 0) return;

  await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          JSON.stringify(payload)
        );
      } catch (error: any) {
        const statusCode = Number(error?.statusCode);
        if (statusCode === 404 || statusCode === 410) {
          await db.pushSubscription.delete({
            where: { id: subscription.id },
          });
        }
      }
    })
  );
}

function buildNotificationCopy(input: ReverifySlotNotificationInput): {
  title: string;
  body: string;
  sequenceId: string;
} {
  const sequenceId = formatQrSequenceId(input.sequence);
  const startText = input.slotStartsAt.toLocaleTimeString();
  const batchText =
    input.batchNumber && input.totalBatches
      ? `Batch ${input.batchNumber}/${input.totalBatches}. `
      : "";

  if (input.reason === "INITIAL_SELECTION") {
    return {
      title: "Reverification slot assigned",
      body: `${batchText}Scan ${sequenceId} at ${startText}. Open Mark Attendance and complete passkey + QR.`,
      sequenceId,
    };
  }

  if (input.reason === "AUTO_RETRY") {
    return {
      title: "Reverification retry assigned",
      body: `${batchText}You were moved to ${sequenceId} at ${startText}. Return to Mark Attendance and scan in this slot.`,
      sequenceId,
    };
  }

  if (input.reason === "LECTURER_TARGET") {
    return {
      title: "Lecturer requested reverification",
      body: `${batchText}Scan ${sequenceId} at ${startText}. This slot was triggered by your lecturer.`,
      sequenceId,
    };
  }

  return {
    title: "Reverification retry confirmed",
    body: `${batchText}Scan ${sequenceId} at ${startText}. Complete passkey verification before your slot.`,
    sequenceId,
  };
}

export async function notifyStudentReverifySlot(
  input: ReverifySlotNotificationInput
): Promise<void> {
  const copy = buildNotificationCopy(input);
  const metadata = {
    sessionId: input.sessionId,
    sequence: input.sequence,
    sequenceId: copy.sequenceId,
    slotStartsAt: input.slotStartsAt.toISOString(),
    slotEndsAt: input.slotEndsAt.toISOString(),
    attemptCount: input.attemptCount,
    retryCount: input.retryCount,
    reason: input.reason,
    batchNumber: input.batchNumber ?? null,
    totalBatches: input.totalBatches ?? null,
  };

  await db.userNotification.create({
    data: {
      userId: input.studentId,
      type: "SYSTEM",
      title: copy.title,
      body: copy.body,
      sentAt: new Date(),
      metadata,
    },
  });

  await sendPushToUser(input.studentId, {
    title: copy.title,
    body: copy.body,
    data: {
      url: `/student/attend?sessionId=${encodeURIComponent(input.sessionId)}`,
      sessionId: input.sessionId,
      sequenceId: copy.sequenceId,
      slotStartsAt: input.slotStartsAt.toISOString(),
      slotEndsAt: input.slotEndsAt.toISOString(),
    },
  });
}

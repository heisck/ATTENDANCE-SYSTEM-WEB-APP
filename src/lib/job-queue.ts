import { JobStatus, JobType } from "@prisma/client";
import { db } from "@/lib/db";
import { destroyCloudinaryAsset } from "@/lib/cloudinary";

export async function enqueueJob(input: {
  type: JobType;
  payload: Record<string, any>;
  runAt?: Date;
  maxAttempts?: number;
  organizationId?: string | null;
}) {
  return db.jobQueue.create({
    data: {
      type: input.type,
      payload: input.payload,
      runAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
      organizationId: input.organizationId ?? null,
      status: JobStatus.PENDING,
    },
  });
}

export async function enqueueManyJobs(
  jobs: Array<{
    type: JobType;
    payload: Record<string, any>;
    runAt?: Date;
    maxAttempts?: number;
    organizationId?: string | null;
  }>
) {
  if (jobs.length === 0) return;

  await db.jobQueue.createMany({
    data: jobs.map((job) => ({
      type: job.type,
      payload: job.payload,
      runAt: job.runAt ?? new Date(),
      maxAttempts: job.maxAttempts ?? 5,
      organizationId: job.organizationId ?? null,
      status: JobStatus.PENDING,
    })),
  });
}

async function processDeleteCloudinaryAsset(payload: Record<string, any>) {
  const publicId = typeof payload.publicId === "string" ? payload.publicId : "";
  const resourceType =
    payload.resourceType === "image" || payload.resourceType === "raw" || payload.resourceType === "video"
      ? payload.resourceType
      : "raw";

  if (!publicId) {
    throw new Error("Invalid DELETE_CLOUDINARY_ASSET payload");
  }

  const deleted = await destroyCloudinaryAsset({ publicId, resourceType });
  if (!deleted) {
    throw new Error("Cloudinary delete failed");
  }
}

async function processSendNotification(payload: Record<string, any>) {
  const userId = typeof payload.userId === "string" ? payload.userId : "";
  const title = typeof payload.title === "string" ? payload.title : "";
  const body = typeof payload.body === "string" ? payload.body : "";
  const type = typeof payload.type === "string" ? payload.type : "SYSTEM";
  const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};

  if (!userId || !title || !body) {
    throw new Error("Invalid SEND_NOTIFICATION payload");
  }

  await db.userNotification.create({
    data: {
      userId,
      type: type as any,
      title,
      body,
      metadata,
      sentAt: new Date(),
    },
  });
}

async function processReminder(payload: Record<string, any>, type: JobType) {
  const userId = typeof payload.userId === "string" ? payload.userId : "";
  const title = typeof payload.title === "string" ? payload.title : "";
  const body = typeof payload.body === "string" ? payload.body : "";
  const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};

  if (!userId || !title || !body) {
    throw new Error(`Invalid ${type} payload`);
  }

  await db.userNotification.create({
    data: {
      userId,
      type: "UPCOMING_CLASS",
      title,
      body,
      metadata,
      sentAt: new Date(),
    },
  });
}

async function processJob(job: {
  id: string;
  type: JobType;
  payload: any;
}) {
  const payload = job.payload && typeof job.payload === "object" ? job.payload : {};

  switch (job.type) {
    case JobType.DELETE_CLOUDINARY_ASSET:
      await processDeleteCloudinaryAsset(payload);
      return;
    case JobType.SEND_NOTIFICATION:
      await processSendNotification(payload);
      return;
    case JobType.ASSIGNMENT_REMINDER:
    case JobType.CLASS_REMINDER:
    case JobType.EXAM_REMINDER:
      await processReminder(payload, job.type);
      return;
    default:
      throw new Error(`Unsupported job type: ${job.type}`);
  }
}

export async function runDueJobs(batchSize = 100) {
  const now = new Date();

  const dueJobs = await db.jobQueue.findMany({
    where: {
      status: JobStatus.PENDING,
      runAt: { lte: now },
    },
    orderBy: { runAt: "asc" },
    take: batchSize,
  });

  let processed = 0;
  let failed = 0;

  for (const job of dueJobs) {
    const locked = await db.jobQueue.updateMany({
      where: {
        id: job.id,
        status: JobStatus.PENDING,
      },
      data: {
        status: JobStatus.RUNNING,
        lockedAt: now,
      },
    });

    if (locked.count === 0) {
      continue;
    }

    try {
      await processJob(job);
      await db.jobQueue.update({
        where: { id: job.id },
        data: {
          status: JobStatus.DONE,
          finishedAt: new Date(),
          lastError: null,
        },
      });
      processed += 1;
    } catch (error: any) {
      const nextAttempts = job.attempts + 1;
      const exhausted = nextAttempts >= job.maxAttempts;

      await db.jobQueue.update({
        where: { id: job.id },
        data: {
          status: exhausted ? JobStatus.FAILED : JobStatus.PENDING,
          attempts: nextAttempts,
          lastError: error?.message || "Job failed",
          runAt: exhausted ? job.runAt : new Date(Date.now() + 60_000),
          lockedAt: null,
          finishedAt: exhausted ? new Date() : null,
        },
      });

      failed += 1;
    }
  }

  return {
    queued: dueJobs.length,
    processed,
    failed,
  };
}
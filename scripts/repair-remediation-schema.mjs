import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function columnMeta(tableName, columnName) {
  const rows = await db.$queryRawUnsafe(`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_name = '${tableName}'
      AND column_name = '${columnName}'
    LIMIT 1
  `);

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function constraintExists(constraintName) {
  const rows = await db.$queryRawUnsafe(`
    SELECT 1
    FROM pg_constraint
    WHERE conname = '${constraintName}'
    LIMIT 1
  `);

  return Array.isArray(rows) && rows.length > 0;
}

async function indexExists(indexName) {
  const rows = await db.$queryRawUnsafe(`
    SELECT 1
    FROM pg_indexes
    WHERE indexname = '${indexName}'
    LIMIT 1
  `);

  return Array.isArray(rows) && rows.length > 0;
}

async function repairPasswordChangedAt() {
  const existing = await columnMeta("User", "passwordChangedAt");
  if (existing) {
    console.log('Column "User"."passwordChangedAt" already exists.');
    return;
  }

  await db.$executeRawUnsafe(`
    ALTER TABLE "User"
    ADD COLUMN "passwordChangedAt" TIMESTAMP(3)
  `);
  console.log('Added column "User"."passwordChangedAt".');
}

async function repairGroupMembershipSessionId() {
  const existing = await columnMeta("GroupMembership", "sessionId");
  if (!existing) {
    await db.$executeRawUnsafe(`
      ALTER TABLE "GroupMembership"
      ADD COLUMN "sessionId" TEXT
    `);
    console.log('Added column "GroupMembership"."sessionId".');
  } else {
    console.log('Column "GroupMembership"."sessionId" already exists.');
  }

  await db.$executeRawUnsafe(`
    UPDATE "GroupMembership" AS gm
    SET "sessionId" = sg."sessionId"
    FROM "StudentGroup" AS sg
    WHERE gm."groupId" = sg."id"
      AND gm."sessionId" IS NULL
  `);
  console.log('Backfilled "GroupMembership"."sessionId" from "StudentGroup"."sessionId".');

  const nullRows = await db.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count
    FROM "GroupMembership"
    WHERE "sessionId" IS NULL
  `);
  const nullCount = Array.isArray(nullRows) && nullRows.length > 0 ? Number(nullRows[0].count ?? 0) : 0;
  if (nullCount > 0) {
    throw new Error(
      `Cannot finalize GroupMembership.sessionId rollout because ${nullCount} rows still have NULL sessionId values.`
    );
  }

  if (!(await constraintExists("GroupMembership_sessionId_fkey"))) {
    await db.$executeRawUnsafe(`
      ALTER TABLE "GroupMembership"
      ADD CONSTRAINT "GroupMembership_sessionId_fkey"
      FOREIGN KEY ("sessionId")
      REFERENCES "GroupFormationSession"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE
    `);
    console.log('Added foreign key "GroupMembership_sessionId_fkey".');
  } else {
    console.log('Foreign key "GroupMembership_sessionId_fkey" already exists.');
  }

  const column = await columnMeta("GroupMembership", "sessionId");
  if (column?.is_nullable === "YES") {
    await db.$executeRawUnsafe(`
      ALTER TABLE "GroupMembership"
      ALTER COLUMN "sessionId" SET NOT NULL
    `);
    console.log('Set "GroupMembership"."sessionId" to NOT NULL.');
  } else {
    console.log('"GroupMembership"."sessionId" is already NOT NULL.');
  }

  if (!(await indexExists("GroupMembership_sessionId_studentId_key"))) {
    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "GroupMembership_sessionId_studentId_key"
      ON "GroupMembership"("sessionId", "studentId")
    `);
    console.log('Created unique index "GroupMembership_sessionId_studentId_key".');
  } else {
    console.log('Unique index "GroupMembership_sessionId_studentId_key" already exists.');
  }

  if (!(await indexExists("GroupMembership_sessionId_idx"))) {
    await db.$executeRawUnsafe(`
      CREATE INDEX "GroupMembership_sessionId_idx"
      ON "GroupMembership"("sessionId")
    `);
    console.log('Created index "GroupMembership_sessionId_idx".');
  } else {
    console.log('Index "GroupMembership_sessionId_idx" already exists.');
  }
}

async function main() {
  await repairPasswordChangedAt();
  await repairGroupMembershipSessionId();
}

main()
  .then(async () => {
    console.log("Remediation schema repair completed successfully.");
    await db.$disconnect();
  })
  .catch(async (error) => {
    console.error("Remediation schema repair failed:", error);
    await db.$disconnect();
    process.exitCode = 1;
  });

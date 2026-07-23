import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const TEST_URL =
  "postgresql://theorytracker:theorytracker@localhost:5432/theorytracker_test";
// The `theorytracker` DB always exists (compose's POSTGRES_DB / a CI service
// container). You cannot connect to theorytracker_test in order to create it.
const ADMIN_URL =
  "postgresql://theorytracker:theorytracker@localhost:5432/theorytracker";

function migrate(): void {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: "pipe",
  });
}

async function createTestDb(): Promise<void> {
  const admin = new PrismaClient({ datasourceUrl: ADMIN_URL });
  try {
    // No CREATE DATABASE IF NOT EXISTS in Postgres; tolerate 42P04
    // (duplicate_database) so a second `npm test` run doesn't die here.
    await admin.$executeRawUnsafe(
      'CREATE DATABASE theorytracker_test OWNER theorytracker',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/42P04|already exists/i.test(msg)) throw e;
  } finally {
    await admin.$disconnect(); // else vitest's globalSetup hangs
  }
}

export default async function setup(): Promise<void> {
  try {
    migrate();
  } catch {
    // test DB missing — create it over the always-present admin DB, then retry
    await createTestDb();
    migrate();
  }
  // clean slate; every FK-bearing table hangs off User or Series
  const prisma = new PrismaClient({ datasourceUrl: TEST_URL });
  await prisma.$executeRawUnsafe('TRUNCATE "User", "Series" CASCADE');
  await prisma.$disconnect();
}

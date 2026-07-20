import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const TEST_URL =
  "postgresql://theorytracker:theorytracker@localhost:5432/theorytracker_test";

function migrate(): void {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: "pipe",
  });
}

export default async function setup(): Promise<void> {
  try {
    migrate();
  } catch {
    // test DB missing (volume predates docker/initdb script) — create it, retry
    execSync(
      `docker exec theorytracker-db-1 psql -U theorytracker -c "CREATE DATABASE theorytracker_test OWNER theorytracker"`,
      { stdio: "pipe" },
    );
    migrate();
  }
  // clean slate; every FK-bearing table hangs off User or Series
  const prisma = new PrismaClient({ datasourceUrl: TEST_URL });
  await prisma.$executeRawUnsafe('TRUNCATE "User", "Series" CASCADE');
  await prisma.$disconnect();
}

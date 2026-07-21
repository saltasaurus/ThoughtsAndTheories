-- CreateEnum
CREATE TYPE "ApiTokenScope" AS ENUM ('READ', 'WRITE');

-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "scope" "ApiTokenScope" NOT NULL DEFAULT 'READ';

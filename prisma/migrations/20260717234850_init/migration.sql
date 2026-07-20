-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'EDITOR', 'READER');

-- CreateEnum
CREATE TYPE "InviteRole" AS ENUM ('EDITOR', 'READER');

-- CreateEnum
CREATE TYPE "SectionType" AS ENUM ('PROLOGUE', 'PRELUDE', 'CHAPTER', 'INTERLUDE', 'EPILOGUE', 'END_NOTES', 'APPENDIX', 'OTHER');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('CHARACTER', 'LOCATION', 'EVENT', 'ITEM', 'FACTION', 'CONCEPT', 'THEORY');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'RICHTEXT', 'NUMBER', 'INWORLD_DATE', 'SELECT', 'MULTISELECT', 'CARD_REF', 'IMAGE_URL');

-- CreateEnum
CREATE TYPE "DefaultRevealBehavior" AS ENUM ('CARD', 'SERIES_START');

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('YEAR', 'MONTH', 'DAY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RevisionEntityType" AS ENUM ('CARD', 'CARD_FIELD');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Series" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Part" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "order" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "partId" TEXT,
    "type" "SectionType" NOT NULL,
    "number" INTEGER,
    "title" TEXT,
    "position" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "currentSectionId" TEXT,
    "revealIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "type" "CardType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "confidence" INTEGER,
    "revealSectionId" TEXT NOT NULL,
    "revealIndex" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardField" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "templateFieldId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "revealSectionId" TEXT NOT NULL,
    "revealIndex" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardRelation" (
    "id" TEXT NOT NULL,
    "fromCardId" TEXT NOT NULL,
    "toCardId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "directed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "revealSectionId" TEXT NOT NULL,
    "revealIndex" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Revision" (
    "id" TEXT NOT NULL,
    "entityType" "RevisionEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "diff" JSONB NOT NULL,
    "revealIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "cardType" "CardType" NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateField" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "FieldType" NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,
    "defaultRevealBehavior" "DefaultRevealBehavior" NOT NULL DEFAULT 'CARD',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TemplateField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calendar" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "epochLabel" TEXT,
    "daysPerWeek" INTEGER NOT NULL,
    "weekdayNames" JSONB NOT NULL,

    CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEra" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "yearOffset" INTEGER NOT NULL,
    "abbreviation" TEXT NOT NULL,

    CONSTRAINT "CalendarEra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarMonth" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "dayCount" INTEGER NOT NULL,

    CONSTRAINT "CalendarMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEntry" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "cardId" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "revealSectionId" TEXT NOT NULL,
    "revealIndex" INTEGER NOT NULL,
    "eraId" TEXT,
    "year" INTEGER,
    "monthOrder" INTEGER,
    "day" INTEGER,
    "precision" "DatePrecision" NOT NULL,
    "displayOverride" TEXT,
    "absoluteSortKey" BIGINT,
    "manualSortKey" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubSession" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "goalSectionId" TEXT NOT NULL,
    "goalRevealIndex" INTEGER NOT NULL,
    "notes" JSONB,
    "createdById" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'UPCOMING',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" "InviteRole" NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Book_seriesId_idx" ON "Book"("seriesId");

-- CreateIndex
CREATE INDEX "Part_bookId_idx" ON "Part"("bookId");

-- CreateIndex
CREATE INDEX "Section_bookId_position_idx" ON "Section"("bookId", "position");

-- CreateIndex
CREATE INDEX "Membership_seriesId_idx" ON "Membership"("seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_seriesId_key" ON "Membership"("userId", "seriesId");

-- CreateIndex
CREATE INDEX "Card_seriesId_revealIndex_idx" ON "Card"("seriesId", "revealIndex");

-- CreateIndex
CREATE INDEX "Card_seriesId_type_idx" ON "Card"("seriesId", "type");

-- CreateIndex
CREATE INDEX "CardField_cardId_revealIndex_idx" ON "CardField"("cardId", "revealIndex");

-- CreateIndex
CREATE INDEX "CardRelation_fromCardId_idx" ON "CardRelation"("fromCardId");

-- CreateIndex
CREATE INDEX "CardRelation_toCardId_idx" ON "CardRelation"("toCardId");

-- CreateIndex
CREATE INDEX "Revision_entityType_entityId_idx" ON "Revision"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_seriesId_cardType_key" ON "Template"("seriesId", "cardType");

-- CreateIndex
CREATE INDEX "TemplateField_templateId_idx" ON "TemplateField"("templateId");

-- CreateIndex
CREATE INDEX "Calendar_seriesId_idx" ON "Calendar"("seriesId");

-- CreateIndex
CREATE INDEX "CalendarEra_calendarId_idx" ON "CalendarEra"("calendarId");

-- CreateIndex
CREATE INDEX "CalendarMonth_calendarId_idx" ON "CalendarMonth"("calendarId");

-- CreateIndex
CREATE INDEX "TimelineEntry_seriesId_revealIndex_idx" ON "TimelineEntry"("seriesId", "revealIndex");

-- CreateIndex
CREATE INDEX "TimelineEntry_seriesId_absoluteSortKey_idx" ON "TimelineEntry"("seriesId", "absoluteSortKey");

-- CreateIndex
CREATE INDEX "ClubSession_seriesId_status_idx" ON "ClubSession"("seriesId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");

-- CreateIndex
CREATE INDEX "Invite_seriesId_idx" ON "Invite"("seriesId");

-- AddForeignKey
ALTER TABLE "Book" ADD CONSTRAINT "Book_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Part" ADD CONSTRAINT "Part_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_currentSectionId_fkey" FOREIGN KEY ("currentSectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_revealSectionId_fkey" FOREIGN KEY ("revealSectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardField" ADD CONSTRAINT "CardField_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardField" ADD CONSTRAINT "CardField_templateFieldId_fkey" FOREIGN KEY ("templateFieldId") REFERENCES "TemplateField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardField" ADD CONSTRAINT "CardField_revealSectionId_fkey" FOREIGN KEY ("revealSectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardRelation" ADD CONSTRAINT "CardRelation_fromCardId_fkey" FOREIGN KEY ("fromCardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardRelation" ADD CONSTRAINT "CardRelation_toCardId_fkey" FOREIGN KEY ("toCardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardRelation" ADD CONSTRAINT "CardRelation_revealSectionId_fkey" FOREIGN KEY ("revealSectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateField" ADD CONSTRAINT "TemplateField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEra" ADD CONSTRAINT "CalendarEra_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarMonth" ADD CONSTRAINT "CalendarMonth_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEntry" ADD CONSTRAINT "TimelineEntry_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEntry" ADD CONSTRAINT "TimelineEntry_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEntry" ADD CONSTRAINT "TimelineEntry_revealSectionId_fkey" FOREIGN KEY ("revealSectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEntry" ADD CONSTRAINT "TimelineEntry_eraId_fkey" FOREIGN KEY ("eraId") REFERENCES "CalendarEra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_goalSectionId_fkey" FOREIGN KEY ("goalSectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one ACTIVE (non-deleted) session per series.
-- Prisma's schema DSL cannot express a partial unique index; raw SQL per spec.
CREATE UNIQUE INDEX "one_active_session_per_series"
  ON "ClubSession" ("seriesId")
  WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;

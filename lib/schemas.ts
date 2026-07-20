import { z } from "zod";
import type { FieldType } from "@prisma/client";

// ---------- auth ----------

export const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80),
  password: z.string().min(8).max(200),
  inviteCode: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ---------- structure ----------

export const sectionTypeSchema = z.enum([
  "PROLOGUE",
  "PRELUDE",
  "CHAPTER",
  "INTERLUDE",
  "EPILOGUE",
  "END_NOTES",
  "APPENDIX",
  "OTHER",
]);

export const bookSchema = z.object({ title: z.string().min(1).max(200) });

export const partSchema = z.object({
  bookId: z.string().min(1),
  number: z.number().int().min(1),
  title: z.string().max(200).nullable().optional(),
});

export const sectionCreateSchema = z.object({
  bookId: z.string().min(1),
  partId: z.string().nullable().optional(),
  type: sectionTypeSchema,
  number: z.number().int().min(1).nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  /** null = insert at the start of the book */
  afterSectionId: z.string().nullable(),
});

// ---------- cards ----------

export const cardTypeSchema = z.enum([
  "CHARACTER",
  "LOCATION",
  "EVENT",
  "ITEM",
  "FACTION",
  "CONCEPT",
  "THEORY",
]);

export const cardCreateSchema = z.object({
  type: cardTypeSchema,
  title: z.string().min(1).max(300),
  summary: z.string().max(2000).optional(),
  confidence: z.number().int().min(1).max(5).optional(),
  revealSectionId: z.string().min(1),
  fields: z
    .array(
      z.object({
        templateFieldId: z.string().min(1),
        value: z.unknown(),
        revealSectionId: z.string().optional(),
      }),
    )
    .default([]),
});

export const cardUpdateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  summary: z.string().max(2000).nullable().optional(),
  confidence: z.number().int().min(1).max(5).nullable().optional(),
});

// ---------- relations ----------

export const relationSchema = z.object({
  fromCardId: z.string().min(1),
  toCardId: z.string().min(1),
  type: z.string().min(1).max(100),
  weight: z.number().min(0).max(1).default(0.5),
  directed: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
  revealSectionId: z.string().min(1),
});

// ---------- in-world dates & timeline ----------

export const precisionSchema = z.enum(["YEAR", "MONTH", "DAY", "UNKNOWN"]);

export const inWorldDateSchema = z
  .object({
    eraId: z.string().nullable(),
    year: z.number().int().nullable(),
    monthOrder: z.number().int().min(1).nullable(),
    day: z.number().int().min(1).nullable(),
    precision: precisionSchema,
    displayOverride: z.string().max(200).nullable(),
  })
  .refine(
    (d) => d.precision === "UNKNOWN" || (d.year !== null && d.eraId !== null),
    { message: "Dated entries need an era and a year" },
  );

export const timelineEntrySchema = z.object({
  label: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  cardId: z.string().nullable().optional(),
  revealSectionId: z.string().min(1),
  date: inWorldDateSchema,
  manualSortKey: z.number().int().nullable().optional(),
});

// ---------- sessions ----------

export const sessionStatusSchema = z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]);

export const sessionSchema = z.object({
  title: z.string().min(1).max(200),
  scheduledAt: z.coerce.date().nullable().optional(),
  goalSectionId: z.string().min(1),
  notes: z.unknown().optional(),
  status: sessionStatusSchema.default("UPCOMING"),
});

// ---------- invites ----------

export const inviteSchema = z.object({
  role: z.enum(["EDITOR", "READER"]),
  expiresAt: z.coerce.date().nullable().optional(),
  maxUses: z.number().int().min(1).nullable().optional(),
});

// ---------- progress ----------

export const progressSchema = z.object({
  sectionId: z.string().nullable(),
});

// ---------- per-fieldType value validation ----------

const tiptapDocSchema = z.object({ type: z.literal("doc") }).passthrough();

/** Validate a CardField value against its TemplateField's type/options. */
export function validateFieldValue(
  fieldType: FieldType,
  options: { choices?: string[] } | null,
  value: unknown,
): unknown {
  switch (fieldType) {
    case "TEXT":
      return z.string().max(5000).parse(value);
    case "RICHTEXT":
      return tiptapDocSchema.parse(value);
    case "NUMBER":
      return z.number().finite().parse(value);
    case "INWORLD_DATE":
      return inWorldDateSchema.parse(value);
    case "SELECT": {
      const choices = options?.choices ?? [];
      return z
        .string()
        .refine((s) => choices.includes(s), { message: "Not a valid choice" })
        .parse(value);
    }
    case "MULTISELECT": {
      const choices = options?.choices ?? [];
      return z
        .array(z.string().refine((s) => choices.includes(s), { message: "Not a valid choice" }))
        .parse(value);
    }
    case "CARD_REF":
      return z.object({ cardId: z.string().min(1) }).parse(value);
    case "IMAGE_URL":
      return z.string().url().max(2000).parse(value);
  }
}

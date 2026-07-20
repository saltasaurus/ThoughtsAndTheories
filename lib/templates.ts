import type { CardType, FieldType } from "@prisma/client";

export type TemplateFieldDef = {
  key: string;
  label: string;
  fieldType: FieldType;
  options?: { choices: string[] };
  required?: boolean;
};

/** Default per-type templates, seeded at series creation and editable afterward. */
export const DEFAULT_TEMPLATES: Record<CardType, TemplateFieldDef[]> = {
  CHARACTER: [
    { key: "description", label: "Description", fieldType: "RICHTEXT" },
    { key: "aliases", label: "Aliases", fieldType: "TEXT" },
    { key: "status", label: "Status", fieldType: "SELECT", options: { choices: ["Alive", "Dead", "Unknown"] } },
    { key: "affiliation", label: "Affiliation", fieldType: "CARD_REF" },
    { key: "portrait", label: "Portrait", fieldType: "IMAGE_URL" },
  ],
  LOCATION: [
    { key: "description", label: "Description", fieldType: "RICHTEXT" },
    { key: "region", label: "Region", fieldType: "TEXT" },
    { key: "map", label: "Map", fieldType: "IMAGE_URL" },
  ],
  EVENT: [
    { key: "description", label: "Description", fieldType: "RICHTEXT" },
    { key: "date", label: "In-world date", fieldType: "INWORLD_DATE" },
    { key: "location", label: "Location", fieldType: "CARD_REF" },
  ],
  ITEM: [
    { key: "description", label: "Description", fieldType: "RICHTEXT" },
    { key: "owner", label: "Current owner", fieldType: "CARD_REF" },
    { key: "origin", label: "Origin", fieldType: "TEXT" },
  ],
  FACTION: [
    { key: "description", label: "Description", fieldType: "RICHTEXT" },
    { key: "leader", label: "Leader", fieldType: "CARD_REF" },
    { key: "seat", label: "Seat of power", fieldType: "CARD_REF" },
    { key: "motto", label: "Motto", fieldType: "TEXT" },
  ],
  CONCEPT: [
    { key: "description", label: "Description", fieldType: "RICHTEXT" },
    {
      key: "category",
      label: "Category",
      fieldType: "SELECT",
      options: { choices: ["Magic", "Politics", "Religion", "Culture", "Other"] },
    },
  ],
  THEORY: [
    { key: "argument", label: "Argument", fieldType: "RICHTEXT" },
    {
      key: "status",
      label: "Status",
      fieldType: "SELECT",
      options: { choices: ["Open", "Supported", "Debunked", "Confirmed"] },
    },
  ],
};

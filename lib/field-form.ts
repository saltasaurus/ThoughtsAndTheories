import type { FieldType } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { inWorldDateSchema } from "@/lib/schemas";

/**
 * Extract one template field's value from FormData. Input naming convention:
 *   simple types:   field_<templateFieldId>
 *   INWORLD_DATE:   field_<id>_era / _year / _month / _day / _precision / _override
 * Returns undefined when the input was left empty (field skipped).
 */
export function parseFieldValue(
  fieldType: FieldType,
  formData: FormData,
  templateFieldId: string,
): unknown {
  const name = `field_${templateFieldId}`;
  const raw = formData.get(name);
  switch (fieldType) {
    case "TEXT":
    case "SELECT":
    case "IMAGE_URL": {
      const v = typeof raw === "string" ? raw.trim() : "";
      return v === "" ? undefined : v;
    }
    case "NUMBER": {
      const v = typeof raw === "string" ? raw.trim() : "";
      if (v === "") return undefined;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new AppError("Not a valid number");
      return n;
    }
    case "MULTISELECT": {
      const values = formData.getAll(name).filter((x): x is string => typeof x === "string" && x !== "");
      return values.length === 0 ? undefined : values;
    }
    case "CARD_REF": {
      const v = typeof raw === "string" ? raw.trim() : "";
      return v === "" ? undefined : { cardId: v };
    }
    case "RICHTEXT": {
      // The Tiptap editor posts its document JSON through a hidden input.
      const v = typeof raw === "string" ? raw.trim() : "";
      if (v === "") return undefined;
      try {
        return JSON.parse(v) as unknown;
      } catch {
        throw new AppError("Invalid rich text payload");
      }
    }
    case "INWORLD_DATE": {
      const get = (suffix: string): string => {
        const x = formData.get(`${name}_${suffix}`);
        return typeof x === "string" ? x.trim() : "";
      };
      const precision = get("precision");
      if (precision === "") return undefined;
      const toInt = (s: string): number | null => (s === "" ? null : Number(s));
      return inWorldDateSchema.parse({
        eraId: get("era") === "" ? null : get("era"),
        year: toInt(get("year")),
        monthOrder: toInt(get("month")),
        day: toInt(get("day")),
        precision,
        displayOverride: get("override") === "" ? null : get("override"),
      });
    }
  }
}

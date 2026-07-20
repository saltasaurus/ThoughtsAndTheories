import Link from "next/link";
import { formatInWorldDate, type CalendarLike } from "@/lib/calendar";
import { inWorldDateSchema } from "@/lib/schemas";
import { TiptapContent } from "@/lib/tiptap-render";

/**
 * Render a (already visibility-filtered) CardField value. CARD_REF links only
 * resolve through refTitles, which contains visible cards exclusively.
 */
export function FieldValue({
  fieldType,
  value,
  calendar,
  refTitles,
  seriesId,
}: {
  fieldType: string;
  value: unknown;
  calendar: CalendarLike;
  refTitles: Map<string, string>;
  seriesId: string;
}) {
  switch (fieldType) {
    case "RICHTEXT":
      return <TiptapContent doc={value} />;
    case "INWORLD_DATE": {
      const parsed = inWorldDateSchema.safeParse(value);
      return <span>{parsed.success ? formatInWorldDate(parsed.data, calendar) : "—"}</span>;
    }
    case "CARD_REF": {
      const cardId =
        typeof value === "object" && value !== null && "cardId" in value
          ? String((value as { cardId: unknown }).cardId)
          : null;
      const title = cardId ? refTitles.get(cardId) : undefined;
      if (!cardId || title === undefined) return <span className="text-soft">—</span>;
      return (
        <Link href={`/series/${seriesId}/cards/${cardId}`} className="text-accent underline">
          {title}
        </Link>
      );
    }
    case "IMAGE_URL":
      return typeof value === "string" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="max-h-48 rounded-md border border-line" />
      ) : null;
    case "MULTISELECT":
      return <span>{Array.isArray(value) ? value.join(", ") : ""}</span>;
    default:
      return <span>{typeof value === "string" || typeof value === "number" ? String(value) : ""}</span>;
  }
}

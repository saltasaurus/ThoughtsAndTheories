import type { SectionType } from "@prisma/client";

const TYPE_LABEL: Record<SectionType, string> = {
  PROLOGUE: "Prologue",
  PRELUDE: "Prelude",
  CHAPTER: "Chapter",
  INTERLUDE: "Interlude",
  EPILOGUE: "Epilogue",
  END_NOTES: "End Notes",
  APPENDIX: "Appendix",
  OTHER: "Section",
};

const ROMAN: Array<[number, string]> = [
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

export function roman(n: number): string {
  let out = "";
  let rest = n;
  for (const [value, glyph] of ROMAN) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out || String(n);
}

/** "Chapter 14", "Interlude 2", "Epilogue" — derived from type + number, never the (gated) title. */
export function sectionTypeLabel(section: { type: SectionType; number: number | null }): string {
  const base = TYPE_LABEL[section.type];
  return section.number === null ? base : `${base} ${section.number}`;
}

/** "Book 2 · Part III · Chapter 14". Book/part context optional. Titles are NOT included — they are gated. */
export function sectionLabel(
  section: { type: SectionType; number: number | null },
  context?: {
    book?: { order: number } | null;
    part?: { number: number } | null;
  },
): string {
  const parts: string[] = [];
  if (context?.book) parts.push(`Book ${context.book.order}`);
  if (context?.part) parts.push(`Part ${roman(context.part.number)}`);
  parts.push(sectionTypeLabel(section));
  return parts.join(" · ");
}

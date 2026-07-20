import type { CardType } from "@prisma/client";

/** Static literal class strings so Tailwind's scanner sees them. */
export const TYPE_BADGE: Record<CardType, string> = {
  CHARACTER: "border-character/50 text-character",
  LOCATION: "border-location/50 text-location",
  EVENT: "border-event/50 text-event",
  ITEM: "border-item/50 text-item",
  FACTION: "border-faction/50 text-faction",
  CONCEPT: "border-concept/50 text-concept",
  THEORY: "border-theory/50 text-theory",
};

export const TYPE_EDGE: Record<CardType, string> = {
  CHARACTER: "border-l-character",
  LOCATION: "border-l-location",
  EVENT: "border-l-event",
  ITEM: "border-l-item",
  FACTION: "border-l-faction",
  CONCEPT: "border-l-concept",
  THEORY: "border-l-theory",
};

export const CARD_TYPES: CardType[] = [
  "CHARACTER",
  "LOCATION",
  "EVENT",
  "ITEM",
  "FACTION",
  "CONCEPT",
  "THEORY",
];

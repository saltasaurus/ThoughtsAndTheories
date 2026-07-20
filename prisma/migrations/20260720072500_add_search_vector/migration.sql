-- Precomputed full-text search over Card title + summary.
-- Search gates per-row (one revealIndex per Card), so a precomputed vector is
-- safe here — unlike per-field content, which cannot be indexed without leaking
-- that a term exists in a gated field.
--
-- The column is a PLAIN tsvector kept current by a trigger (not a GENERATED
-- column): Prisma cannot represent a generated expression and would otherwise
-- report perpetual drift and try to drop it. A trigger is invisible to Prisma,
-- so the schema's `Unsupported("tsvector")?` matches the DB exactly.

ALTER TABLE "Card" ADD COLUMN "searchVector" tsvector;

-- Backfill existing rows.
UPDATE "Card"
SET "searchVector" =
  to_tsvector('english', coalesce("title", '') || ' ' || coalesce("summary", ''));

CREATE FUNCTION card_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    to_tsvector('english', coalesce(NEW."title", '') || ' ' || coalesce(NEW."summary", ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER card_search_vector_trigger
  BEFORE INSERT OR UPDATE OF "title", "summary" ON "Card"
  FOR EACH ROW EXECUTE FUNCTION card_search_vector_update();

CREATE INDEX "Card_searchVector_idx" ON "Card" USING GIN ("searchVector");

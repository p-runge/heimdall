ALTER TABLE "keywords" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "keywords" AS k
SET "sort_order" = ranked.row_num
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "site_id" ORDER BY "created_at") - 1 AS row_num
  FROM "keywords"
) AS ranked
WHERE k."id" = ranked."id";
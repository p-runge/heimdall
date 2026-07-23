CREATE TABLE "site_page_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"pattern_key" text NOT NULL,
	"sample_url" text NOT NULL,
	"url_count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "site_page_patterns_site_id_pattern_key_unique" UNIQUE("site_id","pattern_key")
);
--> statement-breakpoint
ALTER TABLE "health_check_runs" ADD COLUMN "site_page_pattern_id" uuid;--> statement-breakpoint
ALTER TABLE "site_page_patterns" ADD CONSTRAINT "site_page_patterns_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_check_runs" ADD CONSTRAINT "health_check_runs_site_page_pattern_id_site_page_patterns_id_fk" FOREIGN KEY ("site_page_pattern_id") REFERENCES "public"."site_page_patterns"("id") ON DELETE set null ON UPDATE no action;
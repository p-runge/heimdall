CREATE TYPE "public"."security_header_expectation_status" AS ENUM('expected', 'disabled');--> statement-breakpoint
ALTER TYPE "public"."alert_type" ADD VALUE 'security_header_regression';--> statement-breakpoint
CREATE TABLE "security_header_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"final_url" text NOT NULL,
	"http_status" integer NOT NULL,
	"headers" jsonb NOT NULL,
	"protections" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_security_header_expectations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"protection_key" text NOT NULL,
	"status" "security_header_expectation_status" NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"disabled_at" timestamp,
	"disabled_by" text,
	"disabled_note" text,
	CONSTRAINT "site_security_header_expectations_site_id_protection_key_unique" UNIQUE("site_id","protection_key")
);
--> statement-breakpoint
ALTER TABLE "security_header_check_runs" ADD CONSTRAINT "security_header_check_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_security_header_expectations" ADD CONSTRAINT "site_security_header_expectations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
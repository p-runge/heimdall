CREATE TYPE "public"."alert_severity" AS ENUM('warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('site_down', 'cert_expiring', 'seo_issue', 'drift_detected', 'rank_drop', 'lighthouse_regression', 'preview_exposed', 'compliance_issue');--> statement-breakpoint
CREATE TYPE "public"."device" AS ENUM('desktop', 'mobile');--> statement-breakpoint
CREATE TYPE "public"."rank_provider" AS ENUM('dataforseo', 'gsc');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"type" "alert_type" NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"message" text NOT NULL,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"related_run_type" text,
	"related_run_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_email" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_rank_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword_id" uuid NOT NULL,
	"competitor_domain" text NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"position" integer,
	"triggered_by" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"impressum_found" boolean DEFAULT false NOT NULL,
	"impressum_heuristics" jsonb,
	"privacy_policy_found" boolean DEFAULT false NOT NULL,
	"cookie_consent_tool_detected" boolean DEFAULT false NOT NULL,
	"cookie_consent_tool" text,
	"unconsented_google_fonts_detected" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drift_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"env_mapping_id" uuid,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"commits_behind" integer DEFAULT 0 NOT NULL,
	"commits_ahead" integer DEFAULT 0 NOT NULL,
	"compare_url" text,
	"status" text
);
--> statement-breakpoint
CREATE TABLE "drift_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drift_check_run_id" uuid NOT NULL,
	"sha" text NOT NULL,
	"message" text NOT NULL,
	"author" text,
	"committed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "environment_branch_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"env_name" text NOT NULL,
	"branch_name" text NOT NULL,
	"is_prod_branch" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"encrypted_token" text NOT NULL,
	"auth_type" text DEFAULT 'pat' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"http_status" integer,
	"response_time_ms" integer,
	"is_up" boolean NOT NULL,
	"error_message" text,
	"tls_expiry_date" timestamp,
	"tls_days_remaining" integer,
	"seo_issues" jsonb
);
--> statement-breakpoint
CREATE TABLE "keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"phrase" text NOT NULL,
	"target_url" text,
	"country" text DEFAULT 'de' NOT NULL,
	"device" "device" DEFAULT 'desktop' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lighthouse_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"performance" integer,
	"accessibility" integer,
	"seo" integer,
	"best_practices" integer,
	"lcp_ms" integer,
	"cls" numeric,
	"inp" integer
);
--> statement-breakpoint
CREATE TABLE "preview_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"http_status" integer,
	"is_password_protected" boolean DEFAULT false NOT NULL,
	"has_no_index_tag" boolean DEFAULT false NOT NULL,
	"is_publicly_exposed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rank_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword_id" uuid NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"provider" "rank_provider" NOT NULL,
	"position" integer,
	"ranked_url" text,
	"serp_features" jsonb
);
--> statement-breakpoint
CREATE TABLE "rank_provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "rank_provider" NOT NULL,
	"site_id" uuid,
	"credentials_ref" text
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"primary_url" text NOT NULL,
	"preview_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"github_owner" text,
	"github_repo" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_rank_checks" ADD CONSTRAINT "competitor_rank_checks_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_check_runs" ADD CONSTRAINT "compliance_check_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_check_runs" ADD CONSTRAINT "drift_check_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_check_runs" ADD CONSTRAINT "drift_check_runs_env_mapping_id_environment_branch_mappings_id_fk" FOREIGN KEY ("env_mapping_id") REFERENCES "public"."environment_branch_mappings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_commits" ADD CONSTRAINT "drift_commits_drift_check_run_id_drift_check_runs_id_fk" FOREIGN KEY ("drift_check_run_id") REFERENCES "public"."drift_check_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_branch_mappings" ADD CONSTRAINT "environment_branch_mappings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_integrations" ADD CONSTRAINT "github_integrations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_check_runs" ADD CONSTRAINT "health_check_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lighthouse_runs" ADD CONSTRAINT "lighthouse_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_check_runs" ADD CONSTRAINT "preview_check_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_check_runs" ADD CONSTRAINT "rank_check_runs_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_provider_configs" ADD CONSTRAINT "rank_provider_configs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
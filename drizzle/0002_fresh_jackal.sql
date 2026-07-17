CREATE TABLE "drift_pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drift_check_run_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"branch_name" text NOT NULL,
	"author_login" text,
	"pr_created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drift_commits" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "environment_branch_mappings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "drift_commits" CASCADE;--> statement-breakpoint
DROP TABLE "environment_branch_mappings" CASCADE;--> statement-breakpoint
ALTER TABLE "drift_check_runs" ADD COLUMN "branch_head_sha" text NOT NULL;--> statement-breakpoint
ALTER TABLE "drift_check_runs" ADD COLUMN "deployment_sha" text;--> statement-breakpoint
ALTER TABLE "drift_check_runs" ADD COLUMN "deployment_commits_behind" integer;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "prod_branch" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "drift_pull_requests" ADD CONSTRAINT "drift_pull_requests_drift_check_run_id_drift_check_runs_id_fk" FOREIGN KEY ("drift_check_run_id") REFERENCES "public"."drift_check_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_check_runs" DROP COLUMN "env_mapping_id";--> statement-breakpoint
ALTER TABLE "drift_check_runs" DROP COLUMN "commits_behind";--> statement-breakpoint
ALTER TABLE "drift_check_runs" DROP COLUMN "commits_ahead";--> statement-breakpoint
ALTER TABLE "drift_check_runs" DROP COLUMN "compare_url";--> statement-breakpoint
ALTER TABLE "drift_check_runs" DROP COLUMN "status";
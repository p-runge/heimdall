import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

export const alertTypeEnum = pgEnum("alert_type", [
  "site_down",
  "cert_expiring",
  "seo_issue",
  "drift_detected",
  "rank_drop",
  "lighthouse_regression",
  "preview_exposed",
  "compliance_issue",
]);
export const alertSeverityEnum = pgEnum("alert_severity", ["warning", "critical"]);
export const alertStatusEnum = pgEnum("alert_status", ["open", "acknowledged", "resolved"]);
export const rankProviderEnum = pgEnum("rank_provider", ["dataforseo", "gsc"]);
export const deviceEnum = pgEnum("device", ["desktop", "mobile"]);

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  contactEmail: text("contact_email"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  primaryUrl: text("primary_url").notNull(),
  previewUrl: text("preview_url"),
  isActive: boolean("is_active").notNull().default(true),
  githubOwner: text("github_owner"),
  githubRepo: text("github_repo"),
  prodBranch: text("prod_branch").notNull().default("main"),
  // Separate from isActive: DataForSEO rank checks cost money per keyword,
  // so automatic SEO watching is an explicit opt-in per site.
  seoWatcherEnabled: boolean("seo_watcher_enabled").notNull().default(false),
  // Total distinct page-type patterns the last sitemap discovery found,
  // before MAX_PATTERNS_PER_SITE truncation — lets the UI warn when patterns
  // are being dropped, even though only the kept ones exist in
  // sitePagePatterns. Null until the first discovery run.
  discoveredPatternCount: integer("discovered_pattern_count"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// One known page sub-type discovered from a site's sitemap (e.g. "/", "/about",
// "/blog/*"). Populated by the daily discovery cron; the health check reads
// this to know which sample URLs to ping instead of only the root page.
export const sitePagePatterns = pgTable(
  "site_page_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    patternKey: text("pattern_key").notNull(),
    sampleUrl: text("sample_url").notNull(),
    // Sitemap URLs that matched this pattern at last discovery; display-only.
    urlCount: integer("url_count").notNull().default(1),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [unique().on(table.siteId, table.patternKey)],
);

export const healthCheckRuns = pgTable("health_check_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  // Null means either a pre-discovery fallback run (root only, no patterns
  // known yet) or a legacy run predating this column.
  sitePagePatternId: uuid("site_page_pattern_id").references(() => sitePagePatterns.id, {
    onDelete: "set null",
  }),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
  httpStatus: integer("http_status"),
  responseTimeMs: integer("response_time_ms"),
  isUp: boolean("is_up").notNull(),
  errorMessage: text("error_message"),
  tlsExpiryDate: timestamp("tls_expiry_date"),
  tlsDaysRemaining: integer("tls_days_remaining"),
  seoIssues: jsonb("seo_issues").$type<{
    missingTitle?: boolean;
    missingMetaDescription?: boolean;
    missingCanonical?: boolean;
    mixedContent?: boolean;
  }>(),
});

export const complianceCheckRuns = pgTable("compliance_check_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
  impressumFound: boolean("impressum_found").notNull().default(false),
  impressumHeuristics: jsonb("impressum_heuristics").$type<{
    hasAddress?: boolean;
    hasContact?: boolean;
    hasRegisterNumber?: boolean;
  }>(),
  privacyPolicyFound: boolean("privacy_policy_found").notNull().default(false),
  cookieConsentToolDetected: boolean("cookie_consent_tool_detected").notNull().default(false),
  cookieConsentTool: text("cookie_consent_tool"),
  unconsentedGoogleFontsDetected: boolean("unconsented_google_fonts_detected")
    .notNull()
    .default(false),
});

export const previewCheckRuns = pgTable("preview_check_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
  httpStatus: integer("http_status"),
  isPasswordProtected: boolean("is_password_protected").notNull().default(false),
  hasNoIndexTag: boolean("has_no_index_tag").notNull().default(false),
  isPubliclyExposed: boolean("is_publicly_exposed").notNull().default(false),
});

export const lighthouseRuns = pgTable("lighthouse_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
  performance: integer("performance"),
  accessibility: integer("accessibility"),
  seo: integer("seo"),
  bestPractices: integer("best_practices"),
  lcpMs: integer("lcp_ms"),
  cls: numeric("cls"),
  inp: integer("inp"),
});

export const driftCheckRuns = pgTable("drift_check_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
  branchHeadSha: text("branch_head_sha").notNull(),
  // Both null when the repo has no GitHub Deployments to compare against
  // (e.g. not using Vercel's GitHub integration) — the PR list below still works.
  deploymentSha: text("deployment_sha"),
  deploymentCommitsBehind: integer("deployment_commits_behind"),
});

export const driftPullRequests = pgTable("drift_pull_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  driftCheckRunId: uuid("drift_check_run_id")
    .notNull()
    .references(() => driftCheckRuns.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  branchName: text("branch_name").notNull(),
  authorLogin: text("author_login"),
  prCreatedAt: timestamp("pr_created_at").notNull(),
});

export const keywords = pgTable("keywords", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  phrase: text("phrase").notNull(),
  targetUrl: text("target_url"),
  country: text("country").notNull().default("de"),
  device: deviceEnum("device").notNull().default("desktop"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const rankCheckRuns = pgTable("rank_check_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  keywordId: uuid("keyword_id")
    .notNull()
    .references(() => keywords.id, { onDelete: "cascade" }),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
  provider: rankProviderEnum("provider").notNull(),
  position: integer("position"),
  rankedUrl: text("ranked_url"),
  serpFeatures: jsonb("serp_features"),
});

export const competitorRankChecks = pgTable("competitor_rank_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  keywordId: uuid("keyword_id")
    .notNull()
    .references(() => keywords.id, { onDelete: "cascade" }),
  competitorDomain: text("competitor_domain").notNull(),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
  position: integer("position"),
  triggeredBy: text("triggered_by").notNull().default("manual"),
});

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  type: alertTypeEnum("type").notNull(),
  severity: alertSeverityEnum("severity").notNull(),
  message: text("message").notNull(),
  status: alertStatusEnum("status").notNull().default("open"),
  relatedRunType: text("related_run_type"),
  relatedRunId: uuid("related_run_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  resolutionNote: text("resolution_note"),
});

export const githubIntegrations = pgTable("github_integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
  encryptedToken: text("encrypted_token").notNull(),
  authType: text("auth_type").notNull().default("pat"),
});

export const rankProviderConfigs = pgTable("rank_provider_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: rankProviderEnum("provider").notNull(),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
  credentialsRef: text("credentials_ref"),
});

export const clientsRelations = relations(clients, ({ many }) => ({
  sites: many(sites),
}));

export const sitesRelations = relations(sites, ({ one, many }) => ({
  client: one(clients, { fields: [sites.clientId], references: [clients.id] }),
  healthCheckRuns: many(healthCheckRuns),
  sitePagePatterns: many(sitePagePatterns),
  complianceCheckRuns: many(complianceCheckRuns),
  previewCheckRuns: many(previewCheckRuns),
  lighthouseRuns: many(lighthouseRuns),
  driftCheckRuns: many(driftCheckRuns),
  keywords: many(keywords),
  alerts: many(alerts),
}));

export const sitePagePatternsRelations = relations(sitePagePatterns, ({ one, many }) => ({
  site: one(sites, { fields: [sitePagePatterns.siteId], references: [sites.id] }),
  healthCheckRuns: many(healthCheckRuns),
}));

export const healthCheckRunsRelations = relations(healthCheckRuns, ({ one }) => ({
  site: one(sites, { fields: [healthCheckRuns.siteId], references: [sites.id] }),
  sitePagePattern: one(sitePagePatterns, {
    fields: [healthCheckRuns.sitePagePatternId],
    references: [sitePagePatterns.id],
  }),
}));

export const complianceCheckRunsRelations = relations(complianceCheckRuns, ({ one }) => ({
  site: one(sites, { fields: [complianceCheckRuns.siteId], references: [sites.id] }),
}));

export const previewCheckRunsRelations = relations(previewCheckRuns, ({ one }) => ({
  site: one(sites, { fields: [previewCheckRuns.siteId], references: [sites.id] }),
}));

export const lighthouseRunsRelations = relations(lighthouseRuns, ({ one }) => ({
  site: one(sites, { fields: [lighthouseRuns.siteId], references: [sites.id] }),
}));

export const driftCheckRunsRelations = relations(driftCheckRuns, ({ one, many }) => ({
  site: one(sites, { fields: [driftCheckRuns.siteId], references: [sites.id] }),
  pullRequests: many(driftPullRequests),
}));

export const driftPullRequestsRelations = relations(driftPullRequests, ({ one }) => ({
  driftCheckRun: one(driftCheckRuns, {
    fields: [driftPullRequests.driftCheckRunId],
    references: [driftCheckRuns.id],
  }),
}));

export const keywordsRelations = relations(keywords, ({ one, many }) => ({
  site: one(sites, { fields: [keywords.siteId], references: [sites.id] }),
  rankCheckRuns: many(rankCheckRuns),
  competitorRankChecks: many(competitorRankChecks),
}));

export const rankCheckRunsRelations = relations(rankCheckRuns, ({ one }) => ({
  keyword: one(keywords, { fields: [rankCheckRuns.keywordId], references: [keywords.id] }),
}));

export const competitorRankChecksRelations = relations(competitorRankChecks, ({ one }) => ({
  keyword: one(keywords, {
    fields: [competitorRankChecks.keywordId],
    references: [keywords.id],
  }),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  site: one(sites, { fields: [alerts.siteId], references: [sites.id] }),
}));

export const githubIntegrationsRelations = relations(githubIntegrations, ({ one }) => ({
  site: one(sites, { fields: [githubIntegrations.siteId], references: [sites.id] }),
}));

export const rankProviderConfigsRelations = relations(rankProviderConfigs, ({ one }) => ({
  site: one(sites, { fields: [rankProviderConfigs.siteId], references: [sites.id] }),
}));

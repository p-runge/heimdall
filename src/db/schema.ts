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
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
  // Separate from isActive: DataForSEO rank checks cost money per keyword,
  // so automatic SEO watching is an explicit opt-in per site.
  seoWatcherEnabled: boolean("seo_watcher_enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const environmentBranchMappings = pgTable("environment_branch_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  envName: text("env_name").notNull(),
  branchName: text("branch_name").notNull(),
  isProdBranch: boolean("is_prod_branch").notNull().default(false),
});

export const healthCheckRuns = pgTable("health_check_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
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
  envMappingId: uuid("env_mapping_id").references(() => environmentBranchMappings.id, {
    onDelete: "set null",
  }),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
  commitsBehind: integer("commits_behind").notNull().default(0),
  commitsAhead: integer("commits_ahead").notNull().default(0),
  compareUrl: text("compare_url"),
  status: text("status"),
});

export const driftCommits = pgTable("drift_commits", {
  id: uuid("id").primaryKey().defaultRandom(),
  driftCheckRunId: uuid("drift_check_run_id")
    .notNull()
    .references(() => driftCheckRuns.id, { onDelete: "cascade" }),
  sha: text("sha").notNull(),
  message: text("message").notNull(),
  author: text("author"),
  committedAt: timestamp("committed_at"),
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
  environmentBranchMappings: many(environmentBranchMappings),
  healthCheckRuns: many(healthCheckRuns),
  complianceCheckRuns: many(complianceCheckRuns),
  previewCheckRuns: many(previewCheckRuns),
  lighthouseRuns: many(lighthouseRuns),
  driftCheckRuns: many(driftCheckRuns),
  keywords: many(keywords),
  alerts: many(alerts),
}));

export const environmentBranchMappingsRelations = relations(
  environmentBranchMappings,
  ({ one }) => ({
    site: one(sites, {
      fields: [environmentBranchMappings.siteId],
      references: [sites.id],
    }),
  }),
);

export const healthCheckRunsRelations = relations(healthCheckRuns, ({ one }) => ({
  site: one(sites, { fields: [healthCheckRuns.siteId], references: [sites.id] }),
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
  envMapping: one(environmentBranchMappings, {
    fields: [driftCheckRuns.envMappingId],
    references: [environmentBranchMappings.id],
  }),
  commits: many(driftCommits),
}));

export const driftCommitsRelations = relations(driftCommits, ({ one }) => ({
  driftCheckRun: one(driftCheckRuns, {
    fields: [driftCommits.driftCheckRunId],
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

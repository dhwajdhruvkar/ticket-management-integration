// =============================================================================
// Centralized server configuration and feature detection.
//
// Every external capability (Postgres, Azure OpenAI, Redis, Entra ID, MS Graph,
// Blob storage) is OPTIONAL. The app reads these once here and exposes simple
// boolean feature flags so the rest of the server can degrade gracefully:
//   - no DATABASE_URL  -> in-memory/JSON store
//   - no Azure OpenAI  -> hashed-embedding + offline template
//   - no Redis         -> in-process job scheduler
//   - no Entra ID      -> dev credential sign-in
// This is what lets the production architecture run as a zero-infra demo.
// =============================================================================

export type DataDriver = "memory" | "prisma";
export type EmailProvider = "graph" | "brevo" | "none";

function val(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function allSet(...names: string[]): boolean {
  return names.every((n) => !!val(n));
}

const databaseUrl = val("DATABASE_URL");
const explicitDriver = val("DATA_DRIVER");
const dataDriver: DataDriver =
  explicitDriver === "prisma" && databaseUrl ? "prisma" : "memory";

const azureOpenAI = {
  endpoint: val("AZURE_OPENAI_ENDPOINT"),
  apiKey: val("AZURE_OPENAI_API_KEY"),
  chatDeployment: val("AZURE_OPENAI_CHAT_DEPLOYMENT") ?? "gpt-4o-mini",
  embeddingDeployment: val("AZURE_OPENAI_EMBEDDING_DEPLOYMENT") ?? "text-embedding-3-small",
  apiVersion: val("AZURE_OPENAI_API_VERSION") ?? "2024-10-21",
};

const graph = {
  tenantId: val("MS_GRAPH_TENANT_ID"),
  clientId: val("MS_GRAPH_CLIENT_ID"),
  clientSecret: val("MS_GRAPH_CLIENT_SECRET"),
  mailbox: val("SUPPORT_MAILBOX"),
};

const auth = {
  secret: val("AUTH_SECRET"),
  entraClientId: val("AUTH_MICROSOFT_ENTRA_ID_ID"),
  entraClientSecret: val("AUTH_MICROSOFT_ENTRA_ID_SECRET"),
  entraIssuer: val("AUTH_MICROSOFT_ENTRA_ID_ISSUER"),
};

const redisUrl = val("REDIS_URL");
const blobConnString = val("AZURE_STORAGE_CONNECTION_STRING");

const entraConfigured = allSet(
  "AUTH_MICROSOFT_ENTRA_ID_ID",
  "AUTH_MICROSOFT_ENTRA_ID_SECRET",
  "AUTH_MICROSOFT_ENTRA_ID_ISSUER"
);

// Demo mode keeps the zero-infra fallbacks (anonymous API actor, x-actor
// header, passwordless credential sign-in). It defaults ON for local demos and
// switches OFF automatically once real SSO is configured; DEMO_MODE=true|false
// always wins. Production deployments should set DEMO_MODE=false explicitly.
const demoModeEnv = val("DEMO_MODE");
const demoMode = demoModeEnv !== undefined ? demoModeEnv === "true" : !entraConfigured;

// Shared secret(s) for inbound webhook HMAC (x-webhook-signature). A per-source
// secret overrides the generic one. Absent secrets: webhooks are open in demo
// mode and rejected in production mode.
const webhookSecrets = {
  generic: val("WEBHOOK_SECRET"),
  zendesk: val("ZENDESK_WEBHOOK_SECRET") ?? val("WEBHOOK_SECRET"),
  freshdesk: val("FRESHDESK_WEBHOOK_SECRET") ?? val("WEBHOOK_SECRET"),
};

// Slack: inbound uses Slack's own v0 signing scheme; outbound posts to an
// incoming-webhook URL.
const slack = {
  signingSecret: val("SLACK_SIGNING_SECRET"),
  webhookUrl: val("SLACK_WEBHOOK_URL"),
};

// Brevo (transactional email + inbound parsing) as an alternative to MS Graph.
// Inbound is push (Brevo POSTs parsed mail to /api/webhooks/brevo); outbound
// uses the transactional API. Attachment download needs the API key.
const brevo = {
  apiKey: val("BREVO_API_KEY"),
  inboundSecret: val("BREVO_INBOUND_SECRET"),
  sender: val("BREVO_SENDER") ?? val("SUPPORT_MAILBOX"),
};

// Email provider selection. EMAIL_PROVIDER = graph | brevo | none forces a
// provider; auto/unset prefers Brevo when its API key is present, else Graph
// when Graph is configured, else none. Flips BOTH ingestion (scheduler poll vs
// Brevo webhook) and outbound (sendGraphMail vs sendBrevoMail) so they stay
// symmetric.
const graphConfigured = allSet("MS_GRAPH_TENANT_ID", "MS_GRAPH_CLIENT_ID", "MS_GRAPH_CLIENT_SECRET");
const brevoConfigured = !!brevo.apiKey;
const envProvider = val("EMAIL_PROVIDER");
const emailProvider: EmailProvider =
  envProvider === "graph" || envProvider === "brevo" || envProvider === "none"
    ? envProvider
    : brevoConfigured
    ? "brevo"
    : graphConfigured
    ? "graph"
    : "none";

export const config = {
  dataDriver,
  databaseUrl,
  dataDir: val("DATA_DIR") ?? ".data",
  azureOpenAI,
  graph,
  auth,
  redisUrl,
  blobConnString,
  llmProvider: val("LLM_PROVIDER"),
  sentryDsn: val("SENTRY_DSN"),
  demoMode,
  webhookSecrets,
  slack,
  brevo,
  /** Active email provider for ingestion + outbound (graph | brevo | none). */
  emailProvider,
  /** Max upload size for ticket attachments (bytes). */
  attachmentMaxBytes: Number(val("ATTACHMENT_MAX_BYTES") ?? 10 * 1024 * 1024),
  /** Azure Blob container for attachments (when the blob feature is on). */
  attachmentsContainer: val("ATTACHMENTS_CONTAINER") ?? "attachments",

  features: {
    postgres: dataDriver === "prisma",
    azureOpenAI: allSet("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY"),
    redis: !!redisUrl,
    entraId: entraConfigured,
    graph: graphConfigured,
    blob: !!blobConnString,
    slackInbound: !!slack.signingSecret,
    slackOutbound: !!slack.webhookUrl,
    brevoInbound: brevoConfigured,
    brevoOutbound: brevoConfigured,
  },
} as const;

export type AppConfig = typeof config;

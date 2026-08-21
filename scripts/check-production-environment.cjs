"use strict";

const {
  PLACEHOLDER_PATTERN,
  validateProductionSecurityEnv,
} = require("./check-production-security.cjs");

const LOCAL_DATABASE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "db",
  "database",
  "postgres",
  "host.docker.internal",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function value(env, name) {
  return String(env[name] ?? "").trim();
}

function isPlaceholder(input) {
  return /[<>]/.test(input) || PLACEHOLDER_PATTERN.test(input);
}

function parsePostgresUrl(raw, name, errors) {
  if (!raw) {
    errors.push(`${name} is required.`);
    return null;
  }
  if (isPlaceholder(raw)) {
    errors.push(`${name} must not contain an example or placeholder value.`);
    return null;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    errors.push(`${name} must be a valid PostgreSQL URL.`);
    return null;
  }

  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    errors.push(`${name} must use the postgresql protocol.`);
  }
  if (!parsed.username || !parsed.password || !parsed.hostname) {
    errors.push(`${name} must include a username, password, and hostname.`);
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    errors.push(`${name} must name a database.`);
  }
  if (LOCAL_DATABASE_HOSTS.has(parsed.hostname.toLowerCase())) {
    errors.push(`${name} must not point to a local or development database.`);
  }
  if (!parsed.hostname.toLowerCase().endsWith(".neon.tech")) {
    errors.push(`${name} must point to the approved Neon production database.`);
  }
  if (parsed.searchParams.get("sslmode") !== "require") {
    errors.push(`${name} must set sslmode=require.`);
  }

  return parsed;
}

function validateEntra(env, errors) {
  const clientId = value(env, "AUTH_MICROSOFT_ENTRA_ID_ID");
  const clientSecret = value(env, "AUTH_MICROSOFT_ENTRA_ID_SECRET");
  const issuer = value(env, "AUTH_MICROSOFT_ENTRA_ID_ISSUER");

  // Entra is an optional UI capability. With the complete trio absent, the
  // production deployment is deliberately API-key-only. Partial configuration
  // still fails because it would render an unusable or unsafe SSO provider.
  if (!clientId && !clientSecret && !issuer) return;

  if (!UUID_PATTERN.test(clientId) || isPlaceholder(clientId)) {
    errors.push("AUTH_MICROSOFT_ENTRA_ID_ID must be a production application UUID.");
  }
  if (
    clientSecret.length < 16 ||
    isPlaceholder(clientSecret) ||
    new Set(clientSecret).size < 8
  ) {
    errors.push("AUTH_MICROSOFT_ENTRA_ID_SECRET must be a non-placeholder production secret.");
  }

  let parsedIssuer;
  try {
    parsedIssuer = new URL(issuer);
  } catch {
    errors.push("AUTH_MICROSOFT_ENTRA_ID_ISSUER must be a valid HTTPS tenant issuer URL.");
    return;
  }
  const issuerParts = parsedIssuer.pathname.split("/").filter(Boolean);
  if (
    parsedIssuer.protocol !== "https:" ||
    parsedIssuer.hostname.toLowerCase() !== "login.microsoftonline.com" ||
    issuerParts.length !== 2 ||
    !UUID_PATTERN.test(issuerParts[0] ?? "") ||
    issuerParts[1]?.toLowerCase() !== "v2.0" ||
    parsedIssuer.search ||
    parsedIssuer.hash ||
    isPlaceholder(issuer)
  ) {
    errors.push("AUTH_MICROSOFT_ENTRA_ID_ISSUER must identify a production Entra tenant v2.0 issuer.");
  }
}

function validateAzureStorage(env, errors) {
  const raw = value(env, "AZURE_STORAGE_CONNECTION_STRING");
  if (!raw) {
    // Attachments are explicitly disabled in non-demo runtime code when Azure
    // is absent; production must never fall back to ephemeral serverless disk.
    return;
  }
  if (isPlaceholder(raw)) {
    errors.push("AZURE_STORAGE_CONNECTION_STRING must not contain an example or placeholder value.");
    return;
  }

  const fields = new Map();
  for (const part of raw.split(";")) {
    if (!part) continue;
    const separator = part.indexOf("=");
    if (separator <= 0) {
      errors.push("AZURE_STORAGE_CONNECTION_STRING is malformed.");
      return;
    }
    fields.set(part.slice(0, separator), part.slice(separator + 1));
  }

  const accountName = fields.get("AccountName") ?? "";
  const accountKey = fields.get("AccountKey") ?? "";
  if (fields.get("DefaultEndpointsProtocol") !== "https") {
    errors.push("AZURE_STORAGE_CONNECTION_STRING must require HTTPS.");
  }
  if (!/^[a-z0-9]{3,24}$/.test(accountName)) {
    errors.push("AZURE_STORAGE_CONNECTION_STRING must include a valid AccountName.");
  }
  if (
    accountKey.length < 40 ||
    accountKey.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(accountKey)
  ) {
    errors.push("AZURE_STORAGE_CONNECTION_STRING must include a valid AccountKey.");
  }
  if (fields.get("EndpointSuffix") !== "core.windows.net") {
    errors.push("AZURE_STORAGE_CONNECTION_STRING must use the Azure public-cloud endpoint suffix.");
  }
}

function validateProductionEnvironmentEnv(env) {
  const errors = [...validateProductionSecurityEnv(env).errors];

  if (value(env, "DATA_DRIVER") !== "prisma") {
    errors.push("DATA_DRIVER must be explicitly set to prisma.");
  }

  const runtimeUrl = parsePostgresUrl(value(env, "DATABASE_URL"), "DATABASE_URL", errors);
  if (runtimeUrl && !runtimeUrl.hostname.toLowerCase().includes("-pooler.")) {
    errors.push("DATABASE_URL must use the pooled Neon endpoint for application traffic.");
  }

  const directRaw = value(env, "DIRECT_URL");
  if (directRaw) {
    const directUrl = parsePostgresUrl(directRaw, "DIRECT_URL", errors);
    if (directUrl?.hostname.toLowerCase().includes("-pooler.")) {
      errors.push("DIRECT_URL must use the direct Neon endpoint for migrations.");
    }
    if (runtimeUrl && directUrl) {
      const runtimeHost = runtimeUrl.hostname.toLowerCase().replace("-pooler.", ".");
      if (
        runtimeHost !== directUrl.hostname.toLowerCase() ||
        runtimeUrl.pathname !== directUrl.pathname ||
        runtimeUrl.username !== directUrl.username
      ) {
        errors.push("DATABASE_URL and DIRECT_URL must target the same Neon database and role.");
      }
    }
  }

  validateEntra(env, errors);
  validateAzureStorage(env, errors);

  return { ok: errors.length === 0, errors };
}

function main() {
  const result = validateProductionEnvironmentEnv(process.env);
  if (!result.ok) {
    console.error("[environment] Production configuration is invalid:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  const authMode = value(process.env, "AUTH_MICROSOFT_ENTRA_ID_ID")
    ? "entra"
    : "api-key-only";
  const attachmentStorage = value(process.env, "AZURE_STORAGE_CONNECTION_STRING")
    ? "azure"
    : "disabled";
  console.log(
    `[environment] Production configuration passed (authentication=${authMode}, attachments=${attachmentStorage}).`
  );
}

if (require.main === module) main();

module.exports = {
  validateProductionEnvironmentEnv,
};

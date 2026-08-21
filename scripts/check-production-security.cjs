"use strict";

const MIN_AUTH_SECRET_LENGTH = 32;
const PLACEHOLDER_PATTERN =
  /(change[-_ ]?me|replace|example|placeholder|password|insecure|development|dev[-_ ]?only|todo)/i;

function validateProductionSecurityEnv(env) {
  const errors = [];
  const demoMode = String(env.DEMO_MODE ?? "").trim();
  const authSecret = String(env.AUTH_SECRET ?? "").trim();

  if (demoMode !== "false") {
    errors.push("DEMO_MODE must be explicitly set to false.");
  }

  if (authSecret.length < MIN_AUTH_SECRET_LENGTH) {
    errors.push(
      `AUTH_SECRET must contain at least ${MIN_AUTH_SECRET_LENGTH} characters generated from a cryptographically secure source.`
    );
  } else {
    if (PLACEHOLDER_PATTERN.test(authSecret)) {
      errors.push("AUTH_SECRET must not be an example or placeholder value.");
    }
    if (new Set(authSecret).size < 10) {
      errors.push("AUTH_SECRET does not contain enough character diversity.");
    }
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const result = validateProductionSecurityEnv(process.env);
  if (!result.ok) {
    console.error("[security] Production configuration is invalid:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("[security] Production authentication configuration passed.");
}

if (require.main === module) main();

module.exports = {
  MIN_AUTH_SECRET_LENGTH,
  PLACEHOLDER_PATTERN,
  validateProductionSecurityEnv,
};

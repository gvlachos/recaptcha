/**
 * config.js
 * ---------------------------------------------------------------
 * Centralised, validated environment configuration for the
 * reCAPTCHA (Sept 2026) verification service.
 *
 * WHY THIS FILE EXISTS
 * All configuration is read from `process.env` in exactly one
 * place. Every other module in this project imports the resolved
 * `config` object from here instead of touching `process.env`
 * directly. This means:
 *   - There is one place to look to see every setting this service
 *     understands (see .env.example for the documented list).
 *   - The service fails fast, with a clear error message, at
 *     startup if a required setting is missing or malformed —
 *     instead of failing confusingly on the first real request.
 *
 * HOW TO USE
 *   const { config } = require('./config');
 *   console.log(config.projectNumber);
 *
 * See .env.example in the project root for a full description of
 * every environment variable referenced below.
 * ---------------------------------------------------------------
 */

'use strict';

// Loads variables from a local `.env` file into process.env during
// local development. In most production deployments you will
// instead inject real environment variables via your platform
// (systemd unit, container orchestrator secret, etc.) and this
// call becomes a harmless no-op if no .env file is present.
require('dotenv').config();

/**
 * Reads a required environment variable.
 * Throws a descriptive error at startup if it is missing or empty,
 * rather than letting `undefined` silently propagate into a Google
 * API call and fail with a much less obvious error later.
 */
function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null || value.trim() === '') {
    throw new Error(
      `[config] Missing required environment variable "${name}". ` +
        'See .env.example for what this should contain and why it is required.'
    );
  }
  return value.trim();
}

/**
 * Reads an optional environment variable, falling back to a
 * provided default when unset.
 */
function optionalEnv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === null || value.trim() === '') {
    return defaultValue;
  }
  return value.trim();
}

/**
 * Reads an optional numeric environment variable, validating that
 * it actually parses as a finite number and (optionally) falls
 * within an inclusive [min, max] range. This exists specifically
 * to catch typos like RECAPTCHA_SCORE_THRESHOLD="0..5" at startup
 * instead of silently producing NaN comparisons at request time.
 */
function optionalNumberEnv(name, defaultValue, { min, max } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return defaultValue;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `[config] Environment variable "${name}" must be a number, got "${raw}".`
    );
  }
  if (min !== undefined && parsed < min) {
    throw new Error(`[config] Environment variable "${name}" must be >= ${min}, got ${parsed}.`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`[config] Environment variable "${name}" must be <= ${max}, got ${parsed}.`);
  }
  return parsed;
}

/**
 * Converts a canonical, label-style application identifier (e.g.
 * "app-01" — the SAME value used as the `app` label on the
 * reCAPTCHA key itself; see the migration guide, Sections 5 and 7)
 * into the environment-variable-safe suffix used to look up that
 * app's site key (e.g. "APP_01", matching
 * RECAPTCHA_SITE_KEY_APP_01).
 *
 * This exists so every caller — the frontend, this config module,
 * and any other internal caller — can use ONE identifier spelling
 * ("app-01") without needing to know or reproduce the
 * environment-variable-safe spelling themselves. Normalization
 * happens in exactly this one place.
 */
function normalizeAppIdToEnvSuffix(appId) {
  return String(appId).trim().toUpperCase().replace(/-/g, '_');
}

/**
 * Builds the { RECAPTCHA_SITE_KEY_APP_01: '...', ... } style
 * per-application site key map into a plain lookup object, keyed by
 * the RAW environment-variable suffix as it appears in the
 * variable name, e.g. { APP_01: '6Lc-...', APP_02: '6Lc-...' }.
 *
 * Callers should NOT read this map directly with an unnormalized
 * appId (e.g. "app-01") — use `getSiteKeyForApp(appId)` below,
 * which applies `normalizeAppIdToEnvSuffix()` first. This map is
 * exported mainly for diagnostics/testing.
 *
 * This lets one backend instance safely serve multiple frontend
 * applications while still validating that a token presented for
 * "app-01" was actually minted with app-01's site key (defense
 * against a token being replayed against the wrong app's endpoint
 * — see src/recaptchaVerification.js).
 *
 * If your deployment topology is "one backend instance per app"
 * (simpler, and matches a lot of existing setups), you can ignore
 * this map entirely and rely on the single RECAPTCHA_SITE_KEY
 * value instead — see config.defaultSiteKey below.
 */
function buildSiteKeyMap() {
  const prefix = 'RECAPTCHA_SITE_KEY_';
  const map = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && value && value.trim() !== '') {
      const envSuffix = key.slice(prefix.length); // e.g. "APP_01"
      map[envSuffix] = value.trim();
    }
  }
  return map;
}

// ---------------------------------------------------------------
// Resolve and validate configuration once, at module load time.
// If anything required is missing, this throws immediately when
// the module is first imported (i.e. at process startup, via
// server.js), which is exactly when you want to find out about a
// misconfiguration — not on the first incoming HTTP request.
// ---------------------------------------------------------------

const config = Object.freeze({
  // --- Google Cloud project targeted for assessment calls ---
  // NOTE: this must be the numeric *project number*, not the
  // string *project ID* — the Enterprise API's `parent` path
  // requires the number. See .env.example section 1 for how to
  // look this up with `gcloud projects describe`.
  projectNumber: requireEnv('RECAPTCHA_PROJECT_NUMBER'),

  // --- Site key(s) this backend instance is allowed to verify ---
  // Single-app deployments: use `defaultSiteKey`.
  // Multi-app deployments: use `siteKeysByApp` and pass an
  // explicit `appId` into verifyRecaptchaToken() per request.
  defaultSiteKey: optionalEnv('RECAPTCHA_SITE_KEY', undefined),
  siteKeysByApp: buildSiteKeyMap(),

  // --- Verification policy ---
  scoreThreshold: optionalNumberEnv('RECAPTCHA_SCORE_THRESHOLD', 0.5, { min: 0, max: 1 }),
  tokenMaxAgeSeconds: optionalNumberEnv('RECAPTCHA_TOKEN_MAX_AGE_SECONDS', 120, { min: 1 }),

  // --- HTTP server (only used by the example server.js) ---
  port: optionalNumberEnv('PORT', 3000, { min: 1, max: 65535 }),

  // --- Diagnostics only; does not affect API calls ---
  appEnv: optionalEnv('APP_ENV', 'development'),
});

// A backend needs *at least one* way to know which site key(s) it
// is allowed to verify tokens for. Fail fast if neither the single
// key nor the multi-app map was configured, rather than letting
// every verification request fail with a confusing error later.
if (!config.defaultSiteKey && Object.keys(config.siteKeysByApp).length === 0) {
  throw new Error(
    '[config] No site key configured. Set either RECAPTCHA_SITE_KEY (single-app ' +
      'deployments) or one or more RECAPTCHA_SITE_KEY_<APP_ID> variables ' +
      '(multi-app deployments). See .env.example section 3.'
  );
}

/**
 * Resolves the site key for a given canonical appId (e.g.
 * "app-01"), normalizing it to the environment-variable-safe form
 * first. This is the function callers (e.g.
 * recaptchaVerification.js) should use — never read
 * `config.siteKeysByApp` directly with a raw, unnormalized appId.
 *
 * @param {string} appId Canonical, label-style app identifier (e.g. "app-01").
 * @returns {string|undefined} The configured site key, or undefined if none is set for this appId.
 */
function getSiteKeyForApp(appId) {
  if (!appId) return undefined;
  return config.siteKeysByApp[normalizeAppIdToEnvSuffix(appId)];
}

module.exports = { config, getSiteKeyForApp, normalizeAppIdToEnvSuffix, requireEnv, optionalEnv, optionalNumberEnv };

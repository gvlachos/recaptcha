/**
 * config.js
 * ---------------------------------------------------------------
 * Single source of truth for every reCAPTCHA (Sept 2026) setting
 * this frontend needs. Every other file in this project reads
 * configuration from the `RECAPTCHA_CONFIG` object exported here —
 * nothing else in the codebase should hardcode a site key, action
 * name, or backend URL.
 *
 * WHY A SEPARATE CONFIG FILE
 * This mirrors the companion Node.js backend reference project
 * (see recaptcha-backend/src/config.js), where all configuration
 * is likewise resolved in exactly one place. On the frontend there
 * is no environment-variable mechanism at runtime the way there is
 * in Node.js, so the values below are populated at BUILD TIME by
 * your existing per-environment configuration/build pipeline (the
 * same place your app already injects other per-environment values
 * today, e.g. API base URLs).
 *
 * HOW TO WIRE THIS INTO YOUR BUILD
 * The placeholder values below (e.g. "__RECAPTCHA_SITE_KEY__") are
 * written so they are easy to find-and-replace or template with
 * whatever your build tooling already uses (webpack DefinePlugin,
 * a simple environment-specific config.<env>.js swapped in at
 * build time, a server-rendered <script> tag that injects real
 * values before this file runs, etc). Pick ONE of these patterns
 * consistent with how the rest of your app already injects
 * per-environment configuration — do not introduce a second,
 * different mechanism just for reCAPTCHA.
 * ---------------------------------------------------------------
 */

// Exposed as a global so plain <script> includes (this reference
// project intentionally avoids requiring a bundler) can read it.
// If your app uses ES modules / a bundler, feel free to convert
// this to `export const RECAPTCHA_CONFIG = { ... }` instead — the
// shape and the comments below still apply unchanged.
window.RECAPTCHA_CONFIG = {
  // ---------------------------------------------------------
  // (REQUIRED) The reCAPTCHA site key for THIS application, in
  // THIS environment (dev / uat / prod each have their own key —
  // see the migration guide, Section 5, "Environments"). This is
  // a public value (it is sent to the browser and to Google), NOT
  // a secret — unlike the backend's credentials, it does not need
  // to be protected, but it DOES need to be the correct key for
  // the environment this code is running in, since each key is
  // domain-restricted and Google will reject calls made from an
  // unexpected hostname.
  //
  // Replace this placeholder with your real per-environment site
  // key via your build pipeline's templating/injection mechanism.
  // ---------------------------------------------------------
  siteKey: '__RECAPTCHA_SITE_KEY__',

  // ---------------------------------------------------------
  // (REQUIRED) Which Google-hosted loader script to use.
  //
  // 'enterprise.js' is the current, officially documented loader
  // for keys migrated to reCAPTCHA (Sept 2026) / Fraud Defense,
  // and is what this reference project uses by default. It exposes
  // the global namespace `grecaptcha.enterprise` (see recaptcha.js
  // in this project).
  //
  // If, during a transition period, you are still pointing this
  // frontend at an UN-migrated classic v3 key, set this to
  // 'api.js' instead, which exposes the older `grecaptcha` global
  // (without the `.enterprise` namespace) — see recaptcha.js for
  // exactly where this switch is read.
  // ---------------------------------------------------------
  loaderScript: 'enterprise.js', // 'enterprise.js' | 'api.js'

  // ---------------------------------------------------------
  // (REQUIRED) The backend endpoint this app sends the resulting
  // token to for verification. This should point at the
  // `/api/verify-recaptcha`-style endpoint documented in the
  // companion backend reference project
  // (recaptcha-backend/src/routes/verify.js) — adjust the path to
  // match wherever your app actually exposes it.
  //
  // Populate this the same way you already configure this app's
  // API base URL for other backend calls; do not hardcode an
  // absolute URL here for a shared/multi-environment codebase.
  // ---------------------------------------------------------
  verifyEndpoint: '/api/verify-recaptcha',

  // ---------------------------------------------------------
  // (OPTIONAL, default: 10000) How long, in milliseconds, to wait
  // for Google's loader script to finish loading before giving up
  // and treating it as a network/availability failure. Increase
  // this if your users are commonly on slow or high-latency
  // networks; keep it short enough that a real outage fails fast
  // rather than leaving the user staring at a stuck "submitting…"
  // state.
  // ---------------------------------------------------------
  scriptLoadTimeoutMs: 10000,

  // ---------------------------------------------------------
  // (OPTIONAL, default: false) When true, logs verbose diagnostic
  // messages (script loading progress, execute() timing, etc.) to
  // the browser console. Intended for use in dev/uat only — leave
  // false in production to avoid leaking operational detail to
  // end users via devtools.
  // ---------------------------------------------------------
  debug: false,

  // ===========================================================
  // SIMULATED_APPS — DEMO / TEST-HARNESS CONFIGURATION ONLY.
  // ===========================================================
  // A real, single-purpose production frontend does NOT need this
  // section at all — it only ever uses the one `siteKey` above.
  //
  // This list exists so `index.html` / `app.js` in this reference
  // project can demonstrate — and let you manually test — the
  // scenario described in the migration guide, Section 6.2 and
  // recaptcha-backend/.env.example section 3: ONE shared backend
  // instance verifying tokens on behalf of SEVERAL different
  // frontend applications, each with its own site key and `appId`.
  //
  // Each entry below stands in for one of your 15 real Angular
  // applications for demo purposes:
  //   - `id`      must exactly match one of the
  //               `RECAPTCHA_SITE_KEY_<APPID>` suffixes configured
  //               on the backend (see recaptcha-backend/.env.example
  //               section 3) — this is the `appId` sent to the
  //               backend with each request.
  //   - `label`   a human-readable name shown in this demo page's
  //               UI only; has no effect on the actual API calls.
  //   - `siteKey` the REAL site key registered for that simulated
  //               application. Replace each placeholder the same
  //               way you would replace `siteKey` above. If you
  //               only have one real test site key available, it
  //               is fine to reuse it across multiple entries here
  //               purely to exercise the UI flow — just be aware
  //               the backend's per-app SITE_KEY_MISMATCH check
  //               will not have anything to actually mismatch
  //               against in that case.
  //
  // To use this project as a real single-application frontend
  // instead of a multi-app test harness, either delete this array
  // or simply leave it empty — `app.js` falls back to using the
  // single `siteKey` above whenever `SIMULATED_APPS` is empty.
  // ===========================================================
  SIMULATED_APPS: [
    { id: 'APP01', label: 'App 01 — Storefront (EU)', siteKey: '__RECAPTCHA_SITE_KEY_APP01__' },
    { id: 'APP02', label: 'App 02 — Storefront (US)', siteKey: '__RECAPTCHA_SITE_KEY_APP02__' },
    { id: 'APP03', label: 'App 03 — Partner Portal', siteKey: '__RECAPTCHA_SITE_KEY_APP03__' },
  ],
};

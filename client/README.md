# reCAPTCHA (Sept 2026) — Frontend Reference Implementation

A minimal, framework-free, heavily-commented HTML/JavaScript reference
implementation for generating reCAPTCHA (score-based) tokens and sending them
to a backend for verification.

This accompanies the `recaptcha-migration-guide.md` document, Section 8
("Frontend Theory and Implementation") and Section 11 (`ng-recaptcha-2` and
alternatives — this project is the framework-agnostic version of the
in-house `RecaptchaService` pattern sketched there). It is designed to pair
with the companion `recaptcha-backend` reference project's
`/api/verify-recaptcha` endpoint.

## Project layout

```
recaptcha-frontend/
├── index.html          # page markup — deliberately has NO Google <script> tag
├── README.md            # this file
├── css/
│   └── styles.css
└── js/
    ├── config.js         # ALL configuration — read this first
    ├── recaptcha.js       # loadRecaptchaScript() + executeRecaptcha()
    └── app.js              # example form-submit wiring
```

## The one rule this project follows throughout

**Google's loader script is never referenced in `<head>`.** It is injected
dynamically, at runtime, by `loadRecaptchaScript()` in `js/recaptcha.js`,
called from application code (`js/app.js`). See the top-of-file comment in
`js/recaptcha.js` and the comment block in `<head>` of `index.html` for the
full reasoning (per-environment site keys, avoiding loading the script on
pages that don't need it, proper timeout/error handling, and one place to
switch loader files). If you're extending this project, keep following this
pattern rather than reverting to a static `<head>` tag.

## Configuration

Every setting this project needs lives in **`js/config.js`**, fully
documented inline. In short:

| Setting | Required | Notes |
|---|---|---|
| `siteKey` | Yes | Per-environment (dev/uat/prod each have their own — see migration guide Section 5). Public value, not a secret. |
| `loaderScript` | Yes | `'enterprise.js'` (default, for migrated keys) or `'api.js'` (legacy, only for un-migrated classic v3 keys). |
| `verifyEndpoint` | Yes | Path/URL of your backend's verification endpoint. |
| `scriptLoadTimeoutMs` | No (default `10000`) | How long to wait for Google's script before failing with a clear error. |
| `debug` | No (default `false`) | Verbose console logging — dev/uat only. |

`js/config.js` ships with a placeholder site key
(`__RECAPTCHA_SITE_KEY__`). **This project does not read environment
variables at runtime** (there is no such mechanism in a plain static
frontend) — your existing build/deploy pipeline must inject the real,
per-environment site key into this file at build time, the same way it
already injects any other per-environment frontend configuration (e.g. an
API base URL). `loadRecaptchaScript()` deliberately checks for and rejects
the unreplaced placeholder value, so a missed injection step fails loudly
during testing instead of silently sending bad requests to Google in
production.

## How it works, end to end

1. `index.html` loads three local scripts, in order: `config.js` →
   `recaptcha.js` → `app.js`. None of these is the Google script itself.
2. `app.js`'s `init()` attaches a submit handler to the demo form and
   optionally "warms up" the Google script early via
   `RecaptchaClient.loadRecaptchaScript()` (see the comment in `app.js` for
   why this is optional and safe to remove).
3. On submit, `app.js` calls `RecaptchaClient.executeRecaptcha('submit_form')`.
   This loads the Google script (if not already loaded) and resolves with a
   token.
4. The token — plus the real form data — is POSTed as JSON to
   `config.verifyEndpoint`.
5. **The frontend never inspects the token or decides pass/fail itself.**
   That decision happens entirely on the backend (see the companion
   `recaptcha-backend` project's `verifyRecaptchaToken()`), which is the only
   place it cannot be bypassed by an attacker who disables or edits this
   page's JavaScript.
6. The UI reacts only to the backend's HTTP response.

## Adapting this for a real, multi-form application

- **Copy the `ACTION_NAME` constant and `handleFormSubmit` pattern from
  `app.js` into each real form/flow**, giving each one its own distinct,
  descriptive action name (e.g. `login`, `checkout_submit`,
  `contact_form`) that matches exactly what your backend route expects — see
  <https://docs.cloud.google.com/recaptcha/docs/actions-website>.
- **`config.js`, `recaptcha.js` stay shared/unchanged** across all of those
  forms — only `app.js`-style per-flow wiring is duplicated, not the
  loading/execution logic.
- If this frontend needs to work against a backend that serves multiple
  applications, add an `appId` field to the JSON payload sent to
  `verifyEndpoint` — see the comment in `app.js` and the companion backend
  project's `.env.example` section 3.

## Content-Security-Policy

If your application sets a CSP header, it must allow the dynamically-injected
script and reCAPTCHA's own network calls/frames:

```
script-src 'self' https://www.google.com https://www.gstatic.com;
frame-src  https://www.google.com;
connect-src 'self' https://www.google.com;
```

This requirement is identical to a static `<head>` integration — dynamic
injection does not change what CSP directives are needed, only when the
script is fetched.

## The badge / disclosure requirement

Google requires either showing the default reCAPTCHA badge (bottom-right
corner, appears automatically once the script loads — do not hide it with
CSS) or, if you hide it, showing your own visible disclosure notice instead.
This project keeps the badge visible and additionally includes the notice
text in `index.html` for clarity — see the comment block above the
`<p class="disclosure">` element before changing this.

## Further reading

- Install score-based keys on web pages —
  <https://docs.cloud.google.com/recaptcha/docs/instrument-web-pages>
- Action names —
  <https://docs.cloud.google.com/recaptcha/docs/actions-website>
- reCAPTCHA FAQ (badge / disclosure requirements) —
  <https://docs.cloud.google.com/recaptcha/docs/faq>
- Companion backend reference project — see `recaptcha-backend/README.md`

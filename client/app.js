/**
 * app.js
 * ---------------------------------------------------------------
 * Example application code showing how a real page uses
 * `RecaptchaClient.executeRecaptcha()` (from recaptcha.js) around
 * a form submission, and sends the resulting token to the backend
 * verification endpoint documented in the companion
 * recaptcha-backend reference project.
 *
 * *** MULTI-APPLICATION SIMULATION ***
 * This file also demonstrates — and lets you manually test — the
 * "one shared backend, several frontend applications" scenario
 * from the migration guide (Section 6.2) and the companion
 * recaptcha-backend project (.env.example section 3). If
 * `config.SIMULATED_APPS` (see config.js) is non-empty, a
 * dropdown is shown letting you choose which simulated application
 * this "submission" pretends to come from. Selecting a different
 * application:
 *   1. Loads THAT application's site key's reCAPTCHA script (via
 *      recaptcha.js's multi-site-key support) if not already
 *      loaded on the page.
 *   2. Generates a token using that site key.
 *   3. Sends that application's `appId` alongside the token to the
 *      backend, so the backend can validate the token was actually
 *      minted with the site key registered for that `appId` (see
 *      recaptcha-backend/src/recaptchaVerification.js,
 *      `SITE_KEY_MISMATCH`).
 *
 * A real, single-purpose production frontend does not need any of
 * this — it would simply call `executeRecaptcha(ACTION_NAME)` with
 * no site key override and omit `appId` from the payload entirely.
 * The branching below exists only so this one reference page can
 * demonstrate both cases; copy whichever branch matches your real
 * deployment shape into your actual application.
 * ---------------------------------------------------------------
 */

(function () {
  'use strict';

  const config = window.RECAPTCHA_CONFIG;

  // The action name for THIS form. Must exactly match the
  // `expectedAction` your backend route expects for this same flow
  // (see recaptcha-backend/src/routes/verify.js, EXPECTED_ACTION).
  // Copy this file per protected form/flow and give each one its
  // own distinct, descriptive action name — see:
  // https://docs.cloud.google.com/recaptcha/docs/actions-website
  const ACTION_NAME = 'submit_form';

  function setStatus(message, isError) {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = isError ? 'status status--error' : 'status status--info';
  }

  function setSubmitting(isSubmitting) {
    const button = document.getElementById('submit-button');
    if (!button) return;
    button.disabled = isSubmitting;
    button.textContent = isSubmitting ? 'Submitting…' : 'Submit';
  }

  /**
   * Populates the "simulate application" dropdown from
   * `config.SIMULATED_APPS` and returns a lookup map of
   * `appId -> { id, label, siteKey }` for use at submit time.
   *
   * Returns an empty map (and hides/no-ops the dropdown) when
   * `SIMULATED_APPS` is empty — i.e. a normal single-application
   * deployment of this project simply never shows this control.
   */
  function initAppSelector() {
    const apps = Array.isArray(config.SIMULATED_APPS) ? config.SIMULATED_APPS : [];
    const wrapper = document.getElementById('app-selector-wrapper');
    const select = document.getElementById('app-selector');

    const appsById = new Map(apps.map((app) => [app.id, app]));

    if (apps.length === 0 || !wrapper || !select) {
      if (wrapper) wrapper.hidden = true;
      return appsById;
    }

    wrapper.hidden = false;
    select.innerHTML = '';
    for (const app of apps) {
      const option = document.createElement('option');
      option.value = app.id;
      option.textContent = app.label;
      select.appendChild(option);
    }

    return appsById;
  }

  async function handleFormSubmit(event, appsById) {
    event.preventDefault();
    setSubmitting(true);
    setStatus('Verifying…', false);

    // Determine which "application" this submission simulates.
    // With no SIMULATED_APPS configured (real single-app
    // deployment), `selectedApp` is undefined and everything below
    // correctly falls back to the plain single-key behavior.
    const select = document.getElementById('app-selector');
    const selectedAppId = select && !select.closest('[hidden]') ? select.value : undefined;
    const selectedApp = selectedAppId ? appsById.get(selectedAppId) : undefined;

    try {
      // --- 1. Get a fresh token for this specific action ---
      // Passing `selectedApp.siteKey` here is what actually causes
      // recaptcha.js to load (if needed) and execute against THAT
      // application's site key rather than the default one — see
      // the "MULTIPLE SITE KEYS" note in recaptcha.js. When there
      // is no selected app, the second argument is simply
      // `undefined` and executeRecaptcha() falls back to
      // `config.siteKey` as normal.
      const token = await window.RecaptchaClient.executeRecaptcha(
        ACTION_NAME,
        selectedApp ? selectedApp.siteKey : undefined
      );

      // --- 2. Send the token (and your real form data) to your
      // backend for verification. The backend does the actual
      // score check — the frontend NEVER decides pass/fail itself;
      // a client-side score check could trivially be bypassed by
      // an attacker who skips this JS entirely.
      const formData = new FormData(event.target);
      const payload = {
        token,
        message: formData.get('message'),
      };

      // `appId` is only included when simulating a specific
      // application (i.e. only relevant to a backend instance that
      // serves multiple frontends — see
      // recaptcha-backend/.env.example section 3 and
      // recaptcha-backend/src/routes/verify.js). A real
      // single-application frontend should omit this field
      // entirely, exactly as this code does when no app is
      // selected.
      if (selectedApp) {
        payload.appId = selectedApp.id;
      }

      const response = await fetch(config.verifyEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      // --- 3. React to the backend's decision ---
      // See recaptcha-backend/src/routes/verify.js for the full
      // set of possible error codes this endpoint can return
      // (RECAPTCHA_SCORE_TOO_LOW, SITE_KEY_MISMATCH,
      // VERIFICATION_TEMPORARILY_UNAVAILABLE, etc.) and adapt the
      // messaging below to your app's UX.
      const contextLabel = selectedApp ? ` (simulated as ${selectedApp.label})` : '';

      if (response.ok && result.verified) {
        setStatus(`Thanks — your submission was received${contextLabel}.`, false);
        event.target.reset();
      } else if (response.status === 503) {
        // Backend is fail-closed on a QUOTA_EXCEEDED condition (see
        // recaptcha-backend README.md "Handling QUOTA_EXCEEDED") —
        // this is an operational issue, not something the user did
        // wrong.
        setStatus('We could not verify your submission right now. Please try again shortly.', true);
      } else if (result && result.error === 'SITE_KEY_MISMATCH') {
        // Expected outcome if you deliberately mismatch a
        // simulated app's declared `appId` against a different
        // app's site key while testing this demo — a useful signal
        // that the backend's per-app validation is working
        // correctly, not a bug in this frontend.
        setStatus(
          `Backend rejected this token: it was not minted with the site key registered ` +
            `for "${selectedApp ? selectedApp.label : selectedAppId}".`,
          true
        );
      } else {
        setStatus(`We could not verify your submission${contextLabel}. Please try again.`, true);
      }
    } catch (err) {
      // Covers script-load failures, network errors calling the
      // backend, etc. — see recaptcha.js for the specific error
      // messages this can surface (script timeout, CSP block,
      // misconfigured/placeholder site key, ...).
      // eslint-disable-next-line no-console
      console.error('reCAPTCHA verification flow failed:', err);
      setStatus('Something went wrong verifying your submission. Please try again.', true);
    } finally {
      setSubmitting(false);
    }
  }

  function init() {
    const form = document.getElementById('demo-form');
    if (!form) return;

    const appsById = initAppSelector();

    form.addEventListener('submit', (event) => handleFormSubmit(event, appsById));

    // OPTIONAL: "warm up" the Google script for the DEFAULT site
    // key as soon as the form is interactive, rather than waiting
    // for the user's submit click to trigger the first network
    // fetch. This is a UX/latency optimization only — it does NOT
    // run an assessment or affect billing by itself; only
    // `executeRecaptcha()` (called from handleFormSubmit above)
    // does that.
    //
    // Note this only warms up the DEFAULT key, not every simulated
    // application's key — warming up every entry in
    // SIMULATED_APPS up front would defeat the cost-optimization
    // point made in recaptcha.js ("only fetch scripts pages
    // actually need"), so each simulated app's script is instead
    // loaded lazily, on first submit for that app, exactly like a
    // real multi-app deployment would.
    window.RecaptchaClient.loadRecaptchaScript().catch((err) => {
      // A warm-up failure is not fatal here — executeRecaptcha()
      // will simply retry loading (and surface a clear error) when
      // the user actually submits. Just log it for diagnostics.
      // eslint-disable-next-line no-console
      console.warn('reCAPTCHA warm-up load failed (will retry on submit):', err);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

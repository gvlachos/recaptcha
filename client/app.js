/**
 * app.js
 * ---------------------------------------------------------------
 * Example application code showing how a real page uses
 * `RecaptchaClient.executeRecaptcha()` (from recaptcha.js) around
 * a form submission, and sends the resulting token to the backend
 * verification endpoint documented in the companion
 * recaptcha-backend reference project.
 *
 * This file is a REFERENCE PATTERN — copy the shape of
 * `handleFormSubmit` into each real form/flow you protect, using a
 * distinct `ACTION_NAME` per flow (see the comment on that constant
 * below).
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

  async function handleFormSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setStatus('Verifying…', false);

    try {
      // --- 1. Get a fresh token for this specific action ---
      // `executeRecaptcha()` internally loads the Google script on
      // first use (see recaptcha.js) — nothing else needs to
      // happen before this call.
      const token = await window.RecaptchaClient.executeRecaptcha(ACTION_NAME);

      // --- 2. Send the token (and your real form data) to your
      // backend for verification. The backend does the actual
      // score check — the frontend NEVER decides pass/fail itself;
      // a client-side score check could trivially be bypassed by
      // an attacker who skips this JS entirely.
      const formData = new FormData(event.target);
      const payload = {
        token,
        // appId is only needed if your backend instance serves
        // multiple frontend applications — see
        // recaptcha-backend/.env.example section 3 and
        // recaptcha-backend/src/routes/verify.js. Omit this field
        // entirely for single-app backend deployments.
        // appId: 'APP01',
        message: formData.get('message'),
      };

      const response = await fetch(config.verifyEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      // --- 3. React to the backend's decision ---
      // See recaptcha-backend/src/routes/verify.js for the full
      // set of possible error codes this endpoint can return
      // (RECAPTCHA_SCORE_TOO_LOW, VERIFICATION_TEMPORARILY_UNAVAILABLE,
      // etc.) and adapt the messaging below to your app's UX.
      if (response.ok && result.verified) {
        setStatus('Thanks — your submission was received.', false);
        event.target.reset();
      } else if (response.status === 503) {
        // Backend is fail-closed on a QUOTA_EXCEEDED condition (see
        // recaptcha-backend README.md "Handling QUOTA_EXCEEDED") —
        // this is an operational issue, not something the user did
        // wrong.
        setStatus('We could not verify your submission right now. Please try again shortly.', true);
      } else {
        setStatus('We could not verify your submission. Please try again.', true);
      }
    } catch (err) {
      // Covers script-load failures, network errors calling the
      // backend, etc. — see recaptcha.js for the specific error
      // messages this can surface (script timeout, CSP block,
      // misconfigured site key, ...).
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
    form.addEventListener('submit', handleFormSubmit);

    // OPTIONAL: "warm up" the Google script as soon as the form is
    // interactive, rather than waiting for the user's submit click
    // to trigger the first network fetch. This is a UX/latency
    // optimization only — it does NOT run an assessment or affect
    // billing by itself; only `executeRecaptcha()` (called from
    // handleFormSubmit above) does that. Comment this out if you
    // would rather defer the network fetch until submit time, e.g.
    // on a page where most visitors never reach the form.
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

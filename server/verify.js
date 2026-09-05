/**
 * routes/verify.js
 * ---------------------------------------------------------------
 * Example Express route showing how an application endpoint (e.g.
 * a login or checkout submission handler) should use
 * verifyRecaptchaToken() from recaptchaVerification.js.
 *
 * This file is a REFERENCE PATTERN, not a generic reusable route —
 * copy and adapt it into each real endpoint that needs reCAPTCHA
 * protection (login, checkout, contact form, etc.), changing the
 * `expectedAction` and the business logic that runs after a
 * successful verification.
 *
 * REQUEST SHAPE EXPECTED BY THIS EXAMPLE
 *   POST /api/verify-recaptcha
 *   Content-Type: application/json
 *   {
 *     "token": "<token from grecaptcha.execute() on the frontend>",
 *     "appId": "APP01"   // optional — only needed in multi-app deployments,
 *                        // see config.js / .env.example section 3
 *   }
 * ---------------------------------------------------------------
 */

'use strict';

const express = require('express');
const { verifyRecaptchaToken, RecaptchaVerificationError } = require('../recaptchaVerification');

const router = express.Router();

// The action name expected for THIS route. This must exactly match
// the action string the frontend passed into
// `recaptchaV3Service.execute('submit_form')` (or equivalent) for
// the specific user flow this endpoint protects. Hardcoding it here
// (rather than trusting a value sent by the client) is intentional
// — it is one of the two replay-protection checks performed inside
// verifyRecaptchaToken(). Copy this file per protected flow and
// change this constant accordingly.
const EXPECTED_ACTION = 'submit_form';

router.post('/api/verify-recaptcha', async (req, res) => {
  const { token, appId } = req.body || {};

  try {
    const result = await verifyRecaptchaToken({
      token,
      expectedAction: EXPECTED_ACTION,
      appId, // omit / undefined is fine for single-app deployments
    });

    // --- Structured logging for observability -------------------
    // Emit score/reasons for EVERY request, not just failures, so
    // you can track score-distribution trends over time (see the
    // migration guide, Section 7, on feeding this into BigQuery /
    // Looker Studio). Replace console.log with your existing
    // structured logger (pino, winston, etc.) in a real service.
    console.log(
      JSON.stringify({
        msg: 'recaptcha_assessment',
        action: EXPECTED_ACTION,
        score: result.score,
        success: result.success,
        reasons: result.reasons,
      })
    );

    if (!result.success) {
      // Score was below the configured threshold. This is an
      // ordinary "looks like a bot" outcome, not a system error —
      // respond with a normal 4xx, not a 500.
      return res.status(403).json({
        error: 'RECAPTCHA_SCORE_TOO_LOW',
        message: 'This request could not be verified as human.',
      });
    }

    // --- Success: continue with your real business logic here ---
    // e.g. create the session, process the checkout, save the form
    // submission, etc. This example just echoes success.
    return res.status(200).json({ verified: true, score: result.score });
  } catch (err) {
    if (err instanceof RecaptchaVerificationError) {
      switch (err.reason) {
        case 'MISSING_TOKEN':
        case 'INVALID_TOKEN':
        case 'ACTION_MISMATCH':
        case 'SITE_KEY_MISMATCH':
          // Ordinary, expected rejection reasons — respond 400/403
          // and do NOT treat as an incident.
          console.warn(`recaptcha rejection (${err.reason}): ${err.message}`);
          return res.status(400).json({ error: err.reason, message: err.message });

        case 'QUOTA_EXCEEDED':
          // IMPORTANT: this means Google rejected the *call itself*
          // due to quota/billing, not that the user looked like a
          // bot. Decide and document your fallback policy here —
          // see README.md "Handling QUOTA_EXCEEDED" for the
          // trade-offs between failing open (allow the request
          // through unverified) and failing closed (reject until
          // quota/billing is fixed). This example fails closed and
          // alerts loudly, which is the safer default to start
          // from.
          console.error(`recaptcha QUOTA_EXCEEDED — check billing/quota immediately: ${err.message}`);
          return res.status(503).json({
            error: 'VERIFICATION_TEMPORARILY_UNAVAILABLE',
            message: 'Please try again shortly.',
          });

        case 'UPSTREAM_ERROR':
        default:
          console.error(`recaptcha UPSTREAM_ERROR: ${err.message}`);
          return res.status(502).json({
            error: 'VERIFICATION_UPSTREAM_ERROR',
            message: 'Could not verify this request right now. Please try again.',
          });
      }
    }

    // Anything else is an unexpected bug — let it surface normally
    // (e.g. to a global Express error handler / your APM tool)
    // rather than swallowing it here.
    console.error('Unexpected error during reCAPTCHA verification:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;

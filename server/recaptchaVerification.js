/**
 * recaptchaVerification.js
 * ---------------------------------------------------------------
 * Core reCAPTCHA (Sept 2026) token verification logic.
 *
 * This module replaces the classic v3 flow of:
 *   POST https://www.google.com/recaptcha/api/siteverify
 *     secret=<SECRET_KEY>&response=<TOKEN>
 *   -> { success, score, action }
 *
 * ...with an authenticated call to the reCAPTCHA Enterprise API's
 * `projects.assessments.create` method, via the official Node.js
 * client library. See the accompanying migration guide, Section 9,
 * for the full conceptual background on why this changed (moving
 * from a bare shared-secret call to an authenticated Google Cloud
 * API call).
 *
 * WHAT THIS MODULE DOES, BEYOND A BARE API CALL
 *   1. Validates the token is structurally well-formed before
 *      spending an API call on it.
 *   2. Calls createAssessment() using the shared client from
 *      recaptchaClient.js.
 *   3. Validates `tokenProperties.valid` (was the token real?).
 *   4. Validates `tokenProperties.action` matches the action your
 *      backend route expected (defense against a token minted for
 *      one form/flow being replayed against a different one).
 *   5. Optionally validates the site key used matches the
 *      application this backend route expects (defense against a
 *      token minted for a *different application* being replayed
 *      against this one, relevant to a shared multi-app backend).
 *   6. Applies your configured score threshold to produce a single
 *      simple boolean `success` your application code can branch
 *      on, mirroring today's `score > 0.5` check.
 *   7. Distinguishes "the request was bot-like" from "we couldn't
 *      reach Google / hit a quota limit" — these require different
 *      handling in your calling code (reject the user vs. degrade
 *      gracefully / alert on-call), and collapsing them into one
 *      generic error is a common integration mistake.
 * ---------------------------------------------------------------
 */

'use strict';

const { client } = require('./recaptchaClient');
const { config } = require('./config');

/**
 * Error subclass used for all verification-time failures so that
 * calling code can distinguish "Google told us this looks like a
 * bot / the token was invalid" (an ordinary, expected outcome you
 * should handle by rejecting the request) from unexpected bugs.
 *
 * `reason` is a short machine-readable code — see the JSDoc on
 * verifyRecaptchaToken() below for the full list of possible
 * values and what each one means operationally.
 */
class RecaptchaVerificationError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'RecaptchaVerificationError';
    this.reason = reason;
  }
}

/**
 * Verifies a reCAPTCHA token returned by the frontend and returns
 * a structured result describing whether the request should be
 * trusted.
 *
 * @param {Object} params
 * @param {string} params.token
 *   The token produced by the frontend's `grecaptcha.execute()` /
 *   `ReCaptchaV3Service.execute()` call. Required.
 *
 * @param {string} params.expectedAction
 *   The action name your backend route expects this token to have
 *   been created for (e.g. "login", "checkout_submit"). This MUST
 *   match the `action` string the frontend passed into `execute()`
 *   for the same user flow. Required — do not skip this check; it
 *   is what stops a token obtained from a low-stakes flow (e.g.
 *   "newsletter_signup") being replayed against a high-stakes one
 *   (e.g. "checkout_submit").
 *
 * @param {string} [params.appId]
 *   Which application's site key to validate the token against,
 *   used only when this backend instance serves multiple frontend
 *   applications and `config.siteKeysByApp` is populated (see
 *   config.js and .env.example section 3). Must match one of the
 *   `RECAPTCHA_SITE_KEY_<APPID>` suffixes you configured. If this
 *   backend instance serves a single application, omit this
 *   parameter and `config.defaultSiteKey` is used instead.
 *
 * @returns {Promise<{
 *   success: boolean,
 *   score: number,
 *   reasons: string[],
 * }>}
 *   `success` is the single boolean your route handler should
 *   branch on — true means "treat this request as human", mirroring
 *   today's `score > 0.5` check. `score` and `reasons` are included
 *   for logging/observability even when `success` is true, so you
 *   can track score-distribution trends over time (see the
 *   migration guide, Section 7, on wiring this into BigQuery /
 *   Looker Studio dashboards).
 *
 * @throws {RecaptchaVerificationError}
 *   Thrown — instead of returning `success: false` — for outcomes
 *   that indicate something is wrong with the *integration* rather
 *   than an ordinary "this looks like a bot" verdict. Callers
 *   should catch this separately from a plain `success: false`
 *   result. Possible `reason` values:
 *
 *     'MISSING_TOKEN'
 *       No token was supplied at all — almost always a frontend
 *       integration bug (the `execute()` call failed silently, or
 *       the token was never attached to the request), not a real
 *       user. Log and alert on repeated occurrences.
 *
 *     'INVALID_TOKEN'
 *       Google reports the token itself is malformed, expired
 *       (score-based tokens are valid ~2 minutes), or already used.
 *       Under normal operation this happens occasionally for
 *       legitimate slow users (e.g. a very slow form submission)
 *       and should typically be surfaced to the user as "please try
 *       again" rather than a hard block.
 *
 *     'ACTION_MISMATCH'
 *       The token was valid, but for a different action than this
 *       route expected. Treat as suspicious (possible replay) and
 *       reject the request; this should be rare in normal traffic.
 *
 *     'SITE_KEY_MISMATCH'
 *       The token was minted using a site key belonging to a
 *       different configured application than the one this request
 *       claims to be for. Treat as suspicious and reject.
 *
 *     'QUOTA_EXCEEDED'
 *       Google returned RESOURCE_EXHAUSTED — you have exceeded the
 *       10,000/month organization-wide free allowance and billing
 *       is not enabled (or a genuine rate limit was hit). THIS IS
 *       NOT A BOT SIGNAL — do not reject the user's request purely
 *       on this basis. See README.md "Handling QUOTA_EXCEEDED" for
 *       the recommended fallback behavior, and the migration guide
 *       Section 7 for the budget/quota alerting this should trigger
 *       operationally.
 *
 *     'UPSTREAM_ERROR'
 *       Any other failure calling the Google API (network issue,
 *       auth misconfiguration, Google-side outage, etc). Treat as
 *       an infrastructure problem: log with full detail and apply
 *       your own fallback policy (see README.md), not a bot signal.
 */
async function verifyRecaptchaToken({ token, expectedAction, appId }) {
  // --- 1. Basic input validation, before spending an API call ---
  if (!token || typeof token !== 'string' || token.trim() === '') {
    throw new RecaptchaVerificationError(
      'MISSING_TOKEN',
      'No reCAPTCHA token was supplied with this request.'
    );
  }
  if (!expectedAction || typeof expectedAction !== 'string') {
    // This is a programming error in the *calling* code (a route
    // forgot to pass its expected action), not something caused by
    // the end user — fail loudly during development/testing.
    throw new TypeError(
      'verifyRecaptchaToken() requires an `expectedAction` string. ' +
        'Pass the same action name your frontend used in execute(action).'
    );
  }

  // --- 2. Resolve which site key this token should be checked against ---
  const expectedSiteKey = appId ? config.siteKeysByApp[appId] : config.defaultSiteKey;

  if (!expectedSiteKey) {
    // Configuration problem, not a user-caused failure — surfaced
    // as a thrown error rather than folded into `success: false`.
    throw new Error(
      appId
        ? `[recaptchaVerification] No site key configured for appId "${appId}". ` +
          'Check RECAPTCHA_SITE_KEY_<APPID> in your environment configuration.'
        : '[recaptchaVerification] No default site key configured. ' +
          'Check RECAPTCHA_SITE_KEY in your environment configuration.'
    );
  }

  // --- 3. Build the assessment request ---
  // `parent` identifies the Google Cloud project that owns the key
  // being verified against, using the *project number* (see
  // config.js / .env.example section 1 for why it must be the
  // number, not the string project ID).
  const projectPath = client.projectPath(config.projectNumber);

  const request = {
    parent: projectPath,
    assessment: {
      event: {
        token,
        siteKey: expectedSiteKey,
        // `expectedAction` here tells Google what action *you*
        // expected — Google echoes back what the token was
        // actually created for in the response, and we compare
        // them ourselves below. Passing it here also lets Google's
        // own risk analysis factor in the mismatch.
        expectedAction,
      },
    },
  };

  // --- 4. Call the API ---
  let response;
  try {
    [response] = await client.createAssessment(request);
  } catch (err) {
    // Distinguish quota/rate-limit failures from everything else,
    // because they require a different operational response (see
    // the 'QUOTA_EXCEEDED' documentation above). The client library
    // surfaces this as a gRPC status code; `RESOURCE_EXHAUSTED` is
    // code 8. We check both the numeric code and the string name
    // defensively since the exact shape can vary by client version.
    const isQuotaError =
      err && (err.code === 8 || err.code === 'RESOURCE_EXHAUSTED');

    if (isQuotaError) {
      throw new RecaptchaVerificationError(
        'QUOTA_EXCEEDED',
        'reCAPTCHA assessment quota exceeded (RESOURCE_EXHAUSTED). ' +
          'This is a billing/quota condition, not a bot signal — see ' +
          'README.md "Handling QUOTA_EXCEEDED" for recommended handling.'
      );
    }

    throw new RecaptchaVerificationError(
      'UPSTREAM_ERROR',
      `Failed to call the reCAPTCHA Enterprise API: ${err && err.message ? err.message : err}`
    );
  }

  // --- 5. Validate token properties ---
  const tokenProperties = response.tokenProperties || {};

  if (!tokenProperties.valid) {
    // `invalidReason` is one of Google's own enum values (e.g.
    // EXPIRED, MALFORMED, DUPE, BROWSER_ERROR) — pass it through in
    // the thrown message for logging, but callers should treat any
    // INVALID_TOKEN uniformly (see JSDoc above).
    throw new RecaptchaVerificationError(
      'INVALID_TOKEN',
      `reCAPTCHA token was not valid. Reason: ${tokenProperties.invalidReason || 'UNKNOWN'}`
    );
  }

  if (tokenProperties.action !== expectedAction) {
    throw new RecaptchaVerificationError(
      'ACTION_MISMATCH',
      `Token action "${tokenProperties.action}" does not match expected action "${expectedAction}".`
    );
  }

  // Defense-in-depth: even though we told Google which siteKey to
  // expect in the request, we also re-check the site key Google
  // says the token actually belongs to, for extra certainty in a
  // multi-app deployment. (`tokenProperties.hostname` is also
  // available here if you want to additionally pin to expected
  // domains — see the reCAPTCHA API reference linked in README.md.)
  if (tokenProperties.action && expectedSiteKey && response.event && response.event.siteKey) {
    if (response.event.siteKey !== expectedSiteKey) {
      throw new RecaptchaVerificationError(
        'SITE_KEY_MISMATCH',
        'Token was created with a different site key than expected for this application.'
      );
    }
  }

  // --- 6. Apply the score threshold ---
  const riskAnalysis = response.riskAnalysis || {};
  const score = typeof riskAnalysis.score === 'number' ? riskAnalysis.score : 0;
  const reasons = Array.isArray(riskAnalysis.reasons) ? riskAnalysis.reasons : [];

  return {
    success: score > config.scoreThreshold,
    score,
    reasons,
  };
}

module.exports = { verifyRecaptchaToken, RecaptchaVerificationError };

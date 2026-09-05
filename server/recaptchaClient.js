/**
 * recaptchaClient.js
 * ---------------------------------------------------------------
 * Provides a single, shared instance of the official Google Cloud
 * reCAPTCHA Enterprise Node.js client.
 *
 * CREDENTIALS — HOW THIS ACTUALLY AUTHENTICATES
 * `RecaptchaEnterpriseServiceClient` does NOT read credentials from
 * this project's config.js. Instead, per Google Cloud client
 * library convention, it automatically resolves credentials from
 * the environment via "Application Default Credentials" (ADC),
 * which — in this on-prem deployment — means it reads the
 * `GOOGLE_APPLICATION_CREDENTIALS` environment variable and loads
 * whatever that path points at:
 *
 *   - a Workload Identity Federation credential-config JSON
 *     (RECOMMENDED — see README.md "Authentication: Option A"), or
 *   - a downloaded service-account key JSON
 *     (INTERIM — see README.md "Authentication: Option B").
 *
 * You do not need to (and should not) write any code here to load
 * that file manually — the client library does it for you as long
 * as the environment variable is set correctly before this module
 * is imported. See .env.example section 2 for the full explanation
 * and README.md for step-by-step setup of both options.
 *
 * WHY A SINGLETON
 * Constructing this client establishes gRPC channel state and
 * (for the WIF path) performs token-exchange bookkeeping. Reusing
 * one instance across all requests — rather than creating a new
 * client per HTTP request — avoids unnecessary overhead and
 * repeated credential exchanges. Every module in this project that
 * needs to talk to the reCAPTCHA Enterprise API should import the
 * `client` exported here rather than constructing its own.
 * ---------------------------------------------------------------
 */

'use strict';

const { RecaptchaEnterpriseServiceClient } = require('@google-cloud/recaptcha-enterprise');

// Constructed once, at module load time, and reused for the life
// of the process. If GOOGLE_APPLICATION_CREDENTIALS is missing or
// invalid, this does NOT throw immediately (the client library
// resolves credentials lazily, on the first actual API call) — so
// the very first call to createAssessment() is where a bad
// credential configuration will surface. See
// recaptchaVerification.js for how that failure is caught and
// reported clearly rather than crashing the process.
const client = new RecaptchaEnterpriseServiceClient();

module.exports = { client };

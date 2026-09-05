# reCAPTCHA (Sept 2026) Verification Service — Reference Implementation

A minimal, heavily-commented Node.js reference implementation for verifying
reCAPTCHA tokens against the current Google Cloud reCAPTCHA API
(`@google-cloud/recaptcha-enterprise`), intended to replace a legacy call to
`https://www.google.com/recaptcha/api/siteverify`.

This accompanies the `recaptcha-migration-guide.md` document, Section 9
("Backend Theory and Implementation"). Read that section for the conceptual
background; this project is the working code referenced there.

## Project layout

```
recaptcha-backend/
├── .env.example              # every configuration value, fully documented
├── package.json
├── README.md                 # this file
└── src/
    ├── config.js              # loads + validates environment configuration
    ├── recaptchaClient.js     # shared Google API client singleton
    ├── recaptchaVerification.js  # core verifyRecaptchaToken() logic
    ├── server.js               # minimal example server
    └── routes/
        └── verify.js           # example Express route using verifyRecaptchaToken()
```

**The two files most teams will actually reuse are `src/config.js` and
`src/recaptchaVerification.js`.** `server.js` and `routes/verify.js` are
illustrative — copy the pattern in `routes/verify.js` into each real endpoint
you protect (login, checkout, contact form, etc.), changing `EXPECTED_ACTION`
and the post-verification business logic each time.

## Quick start

```bash
npm install
cp .env.example .env
# edit .env with real values — see the comments in .env.example and
# "Authentication" below
npm start
```

Then:

```bash
curl -X POST http://localhost:3000/api/verify-recaptcha \
  -H "Content-Type: application/json" \
  -d '{"token": "<a real token from your frontend>"}'
```

## Configuration

Every environment variable this service understands is documented in
**`.env.example`**, including which are required vs. optional and why. Do not
duplicate that documentation here — treat `.env.example` as the single source
of truth for configuration, and `src/config.js` as the code that enforces it
at startup.

## Authentication (the part most teams need to plan for)

This backend is assumed to run **on-premises**, not on Google Cloud
infrastructure — so, unlike a service running on GKE/Cloud Run/GCE, there is
no automatic Google identity attached to the process. You must explicitly
provide one of the two options below via the `GOOGLE_APPLICATION_CREDENTIALS`
environment variable (see `.env.example` section 2). The client library
(`@google-cloud/recaptcha-enterprise`) reads this automatically — no code
changes are needed to switch between the two options below, only
configuration.

### Option A — Workload Identity Federation (recommended)

No long-lived Google credential is stored on-prem at all. Your existing
on-prem identity provider (OIDC or SAML) issues a short-lived token, which
Google exchanges for temporary credentials at call time.

High-level one-time setup (run by whoever administers your GCP project — see
the migration guide, Section 6, for the IAM roles involved):

```bash
# 1. Create a workload identity pool for this project
gcloud iam workload-identity-pools create "on-prem-pool" \
  --project="YOUR_PROJECT_ID" \
  --location="global" \
  --display-name="On-prem backend pool"

# 2. Create a provider inside that pool pointing at your on-prem IdP
#    (example shown for a generic OIDC issuer — adapt issuer-uri and
#    attribute-mapping to your actual identity provider)
gcloud iam workload-identity-pools providers create-oidc "on-prem-oidc" \
  --project="YOUR_PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="on-prem-pool" \
  --issuer-uri="https://your-onprem-idp.company.internal" \
  --attribute-mapping="google.subject=assertion.sub"

# 3. Allow that provider to impersonate the recaptcha-agent service
#    account (see the migration guide, Section 6, for why this
#    service account should hold roles/recaptchaenterprise.agent
#    only, not roles/recaptchaenterprise.admin)
gcloud iam service-accounts add-iam-policy-binding \
  "recaptcha-agent@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/on-prem-pool/*"

# 4. Generate the credential CONFIG file (not a secret key!) that
#    this application will read via GOOGLE_APPLICATION_CREDENTIALS
gcloud iam workload-identity-pools create-cred-config \
  "projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/on-prem-pool/providers/on-prem-oidc" \
  --service-account="recaptcha-agent@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --credential-source-file="/path/to/onprem-oidc-token" \
  --output-file="/secure/config/recaptcha-credential-config.json"
```

Point `GOOGLE_APPLICATION_CREDENTIALS` at the resulting
`recaptcha-credential-config.json`. This file describes *how* to obtain a
credential (it references your on-prem token source) — it is not itself a
secret in the way a service-account key is, but it should still be treated as
sensitive configuration and access-controlled like any other deployment
config.

Full official reference:
<https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines>

### Option B — Service account JSON key file (interim / higher risk)

Faster to set up, but the resulting file is a **long-lived static secret**
that must be protected accordingly.

```bash
# Create the service account (one-time, per environment project)
gcloud iam service-accounts create recaptcha-agent \
  --project="YOUR_PROJECT_ID" \
  --display-name="reCAPTCHA verification service"

# Grant it the minimum role needed to call createAssessment
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:recaptcha-agent@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/recaptchaenterprise.agent"

# Download a key (treat the resulting file as a secret from this point on)
gcloud iam service-accounts keys create /secure/config/recaptcha-key.json \
  --iam-account="recaptcha-agent@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

Point `GOOGLE_APPLICATION_CREDENTIALS` at `/secure/config/recaptcha-key.json`.

**Operational requirements for this option, non-negotiable in production:**
- Store the file in your existing on-prem secrets manager (Vault, etc.), not
  a plain file baked into a container image or checked into source control.
- Inject it at process start / container mount time.
- Rotate it on a documented schedule (e.g. every 90 days) using
  `gcloud iam service-accounts keys create` + `... keys delete` for the old
  key, and track this as a recurring operational task, not a one-time setup
  step.
- Treat Option B as a stepping stone to Option A, not a permanent end state,
  per the migration guide's recommendation (Section 6.2).

## Handling `QUOTA_EXCEEDED`

If Google returns `RESOURCE_EXHAUSTED` (surfaced by this project as
`RecaptchaVerificationError` with `reason: 'QUOTA_EXCEEDED'`), it means you
have exceeded the shared 10,000/month organization-wide free allowance
without billing enabled on the project (or hit a genuine rate limit) — **it
does not mean the request looked like a bot.** Do not reject the user on this
basis without a deliberate decision. Two options, with different risk
profiles:

- **Fail closed (default in `routes/verify.js`):** return a 503 and ask the
  user to retry shortly, while alerting your on-call/ops channel loudly. This
  is the safer default because it never lets unverified traffic through, but
  it does mean real users are blocked until the underlying billing/quota
  issue is fixed.
- **Fail open:** allow the request through unverified, logging the incident
  for follow-up. Only appropriate if the protected action has other layers of
  fraud defense, or if availability is a higher priority than bot-blocking
  for that specific flow. If you choose this path, implement it explicitly
  and document why for that route — don't let it happen by accident.

Either way, this condition should trigger the budget/quota alerting described
in the migration guide, Section 7, so it's caught and fixed quickly rather
than persisting.

## Score threshold

`RECAPTCHA_SCORE_THRESHOLD` (default `0.5`) reproduces the same
`score > 0.5` cutoff used with classic reCAPTCHA v3. `verifyRecaptchaToken()`
always returns the raw `score` and `reasons` alongside the boolean `success`
result, specifically so you can log the full distribution (not just the
pass/fail outcome) and re-tune the threshold later using real post-migration
data, rather than assuming `0.5` is still optimal — see the migration guide,
Section 4.3, step 6.

## Multi-application deployments

If a single backend service instance verifies tokens for more than one
frontend application (rather than one backend per app), configure multiple
`RECAPTCHA_SITE_KEY_<APPID>` variables (see `.env.example` section 3) and pass
the corresponding `appId` into `verifyRecaptchaToken()` per request (see
`routes/verify.js`). This ensures a token minted for one application's site
key cannot be replayed against a different application sharing the same
backend.

## Further reading

- Create assessments for websites (REST contract this library wraps) —
  <https://docs.cloud.google.com/recaptcha/docs/create-assessment-website>
- Interpret assessments for websites (score, action, reasons) —
  <https://docs.cloud.google.com/recaptcha/docs/interpret-assessment-website>
- Node.js client library reference —
  <https://docs.cloud.google.com/nodejs/docs/reference/recaptcha-enterprise/latest>
- Workload Identity Federation —
  <https://cloud.google.com/iam/docs/workload-identity-federation>
- Quotas and limits (429 / RESOURCE_EXHAUSTED behavior) —
  <https://docs.cloud.google.com/recaptcha/quotas>

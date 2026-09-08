---
title: "Migrating from reCAPTCHA v3 to reCAPTCHA (Sept 2026)"
subtitle: "Benefits, Challenges, and Implementation Plan for Angular / Node.js Applications"
author: "Engineering Team"
date: "September 2026"
---

# Migrating from reCAPTCHA v3 to reCAPTCHA (Sept 2026)

**A guide for developers and engineering managers**

*Prepared: September 2026*

> **A note on naming.** In April 2026, Google restructured its bot/fraud-protection product into **Google Cloud Fraud Defense**, of which reCAPTCHA is now a part. What used to be a hard split between "reCAPTCHA Classic v3" (free) and "reCAPTCHA Enterprise" (a separate paid product) has been replaced by three tiers — **Essentials**, **Premium**, and **Enterprise** — that all sit on top of the same reCAPTCHA API and the same Google Cloud console. Because "reCAPTCHA Enterprise" now refers specifically to the top, sales-negotiated tier, this document uses **"reCAPTCHA (Sept 2026)"** to mean *the current, Google Cloud–managed reCAPTCHA product as a whole* — distinct from the old "reCAPTCHA Classic" your applications use today, and distinct from the specific "Enterprise" pricing tier discussed in the Costs section. Section 1 explains this in full, with a terminology reconciliation table.

---

## Table of Contents

1. Terminology Reconciliation: From "reCAPTCHA v3" to "reCAPTCHA (Sept 2026)"
2. Benefits of Migrating
3. Challenges and Risks
4. Migration Process
5. Environments: Separating Dev/UAT from Production
6. IAM Roles and Service Accounts
7. Monitoring: Cost, Volume, and Success/Failure Ratios per Project
8. Frontend Theory and Implementation (Angular 21, Standalone Components)
9. Backend Theory and Implementation (Node.js, On-Premises)
10. Costs
11. ng-recaptcha-2: Compatibility and Alternatives
12. Assumptions, Caveats, and Self-Assessment

---

## 1. Terminology Reconciliation: From "reCAPTCHA v3" to "reCAPTCHA (Sept 2026)"

### 1.1 Executive Summary

Google no longer sells "reCAPTCHA Enterprise" as a separate product you opt into. As of April 2026, **all** reCAPTCHA keys — old and new — run on a single API and console, organized into three service tiers: **Essentials** (free, basic), **Premium** (self-service, pay-as-you-go, richer features), and **Enterprise** (contract-based, volume-committed, account-managed). Your 15 applications currently use "reCAPTCHA Classic" v3 keys managed through the standalone reCAPTCHA Admin Console. Migrating means moving those keys into a Google Cloud project so they run under the modern platform — most likely on the **Premium** tier, which is functionally what most people mean today when they say "reCAPTCHA Enterprise." No frontend code changes are required to do this; it is primarily a console/administrative operation, followed by an optional adoption of new backend features. **Bottom line for managers:** this is a low-risk, largely administrative migration with an upside of better fraud analytics and IAM control, and a cost model that only bites once you exceed 10,000 assessments/month organization-wide.

### 1.2 Detailed Discussion

**Why the confusion exists.** Historically:

- **reCAPTCHA v1/v2/v3 "Classic"** — managed via the standalone reCAPTCHA Admin Console (`google.com/recaptcha/admin`), free with a very high usage ceiling, no Google Cloud project required.
- **reCAPTCHA Enterprise** (2019–2026) — a separate Google Cloud product/API (`recaptchaenterprise.googleapis.com`), managed in the Google Cloud Console, with its own pricing (1,000,000 free assessments/month, then $1/1,000).

On **April 2, 2026**, Google collapsed this distinction. Classic keys can no longer be newly created, and reCAPTCHA is now delivered exclusively through the Google Cloud Fraud Defense platform, using the same `recaptchaenterprise.googleapis.com` API and IAM roles that used to be exclusive to "Enterprise." The free allowance also dropped sharply, from 1,000,000/month down to 10,000/month, shared across the *entire organization*.

The three tiers today:

| Tier | How you get it | Cost | Who it's for |
|---|---|---|---|
| **Essentials** | Default for a Google Cloud project with no billing account attached | Free, capped at 10,000 assessments/month (org-wide); requests are rejected (HTTP 429) beyond that | Trial usage, very low-traffic apps |
| **Premium** | Automatic once billing is enabled on the project | Free 0–10k, then $8 flat fee for 10,001–100,000/month, then $1 per 1,000 above 100,000 | The overwhelming majority of self-service customers — **this is what "migrating to reCAPTCHA Enterprise" means for your team** |
| **Enterprise** | Sales-negotiated subscription, 12-month minimum commitment | Fixed monthly volume commitment at $1/1,000 | High-volume, regulated, or support-intensive customers who need a named account manager, advanced analytics, and custom policies |

**What this means for your project:** your goal is not "switch to the Enterprise tier" but **"migrate our 15 classic v3 site keys into Google Cloud projects,"** which lands you on Premium by default once billing is attached. True Enterprise (with its 12-month commitment and sales process) is worth evaluating later if volumes or support needs grow — see Section 10.4.

Google also publishes an official mapping of old vs. new terms, which is worth bookmarking for the team.

### 1.3 Sources

- Fraud Defense / reCAPTCHA overview — <https://docs.cloud.google.com/recaptcha/docs>
- Compare Fraud Defense tiers (Essentials / Premium / Enterprise feature matrix) — <https://docs.cloud.google.com/recaptcha/docs/compare-tiers>
- Billing information (tier definitions, examples) — <https://docs.cloud.google.com/recaptcha/docs/billing-information>
- Reconcile legacy terminology (old term → new term mapping) — <https://docs.cloud.google.com/recaptcha/docs/reconcile-legacy-terminology>
- Frequently Asked Questions — <https://docs.cloud.google.com/recaptcha/docs/faq>
- Pricing page — <https://cloud.google.com/security/products/recaptcha#pricing>

---

## 2. Benefits of Migrating

### 2.1 Executive Summary

Migrating gives the team materially better visibility into fraud and bot traffic (dashboards, richer score explanations, per-key analytics), tighter access control (formal IAM roles instead of ad hoc account ownership in a separate admin console), and a foundation for adding account-takeover and payment-fraud protection later if the business needs it — all without any required frontend rewrite. The main "cost" is administrative: linking billing, assigning IAM roles, and validating dashboards. For most of your 15 apps, near-term financial cost is zero or near-zero (see Section 10).

### 2.2 Detailed Discussion

1. **Unified Google Cloud governance.** Keys live inside your existing GCP organization instead of a separate reCAPTCHA-specific admin console with its own ownership model. This lets you apply the same IAM, audit logging, and org-policy tooling your team already uses for every other GCP resource.
2. **Richer score explainability.** Classic v3 gives you a single float score (0.0–1.0). Migrated keys on Premium/Enterprise expose more granular bot-defense levels (11 levels vs. 4 on Essentials) and — on Premium and above — basic-to-advanced *reason codes* explaining *why* a score was low (e.g., automation framework detected, suspicious IP reputation, low interaction entropy). This materially improves your team's ability to tune the 0.5 threshold you use today.
3. **Native platform logging, audit logging, and dashboards.** Every `CreateAssessment` call can be logged to Cloud Logging and exported to BigQuery/Looker Studio, giving you cost, volume, and score-distribution dashboards without hand-rolled instrumentation in your Node.js backend.
4. **IAM-based access control and service accounts**, replacing informal "site key owner" access in the old admin console — a meaningful win for a 15-app estate maintained by one team, and for satisfying internal security/audit requirements.
5. **Optionality for stronger protection later**, without further frontend migration: Account Defender (account takeover detection), Password Leak/Compromised Credential checks, and Transaction/Fraud Prevention signals for payment flows are all available on the same key once you opt in on the backend — useful if login or checkout flows are ever added to these applications.
6. **No required frontend rewrite.** Google explicitly guarantees existing site-key integrations continue to work unchanged after migration; `grecaptcha.execute()`/`grecaptcha.enterprise.execute()` behavior for score-based keys is preserved.
7. **Clearer cost accountability.** Resource labels + Cloud Billing reports let you attribute reCAPTCHA spend to a specific application/environment for the first time (Section 7), instead of it being invisible/bundled under one shared key.

### 2.3 Sources

- Migrate from reCAPTCHA Classic (no-code-change guarantee) — <https://docs.cloud.google.com/recaptcha/docs/migrate-recaptcha>
- Compare Fraud Defense tiers (score levels, reason codes, feature gating) — <https://docs.cloud.google.com/recaptcha/docs/compare-tiers>
- Use Fraud Defense features after migration — <https://docs.cloud.google.com/recaptcha/docs/using-features>
- Interpret assessments for websites (score levels, reason codes) — <https://docs.cloud.google.com/recaptcha/docs/interpret-assessment-website>
- Account defender — <https://docs.cloud.google.com/recaptcha/docs/account-defender>
- Detect password leaks and breached credentials — <https://docs.cloud.google.com/recaptcha/docs/check-passwords>
- Audit logging — <https://docs.cloud.google.com/recaptcha/docs/audit-logging>

---

## 3. Challenges and Risks

### 3.1 Executive Summary

The migration itself is low-risk and fast (5–10 minutes per key, no code changes), but there are real operational items to plan for: billing must be enabled per project to stay above the free tier without service interruption; the free allowance is now shared across the *whole organization* rather than per app, so a traffic spike in one app can eat into another's headroom; the on-prem backend needs a new authentication path to Google Cloud (no more built-in service account by default, since it isn't running on GCP); and the team must decide on a project/key topology (Section 5–7) before doing any migration, because that decision is expensive to change later (keys can be moved between projects, but IAM, billing labels, and dashboards are all scoped to it).

### 3.2 Detailed Discussion

1. **Free-tier pooling changes the mental model.** Today, most teams assume "my app is fine because it's under some free ceiling." Under the new billing model, the 10,000/month free assessments are **pooled at the organization level**, aggregating every key, site, and app under that Cloud Billing organization. With 15 apps, it takes very little traffic per app to blow past this collectively — billing must be enabled deliberately, in advance, on every project that will run production or meaningfully-trafficked non-production traffic, or requests will start returning `RESOURCE_EXHAUSTED (429)` errors with no fallback.
2. **On-premises backend authentication is not automatic.** Google Cloud workloads get an attached service account "for free." Your Node.js backend runs **on-prem**, so it has no ambient Google credential. You must explicitly choose and implement one of: (a) a downloaded service-account JSON key (simplest, but a long-lived secret to protect and rotate), or (b) **Workload Identity Federation** (recommended — short-lived, no static key material, but requires more setup with your on-prem identity provider). This is a genuine new piece of infrastructure work, not a config toggle.
3. **Migration is per-key and mostly manual.** There is no "migrate all 15 apps at once" bulk button in the console UI (though the REST/`gcloud` API can be scripted). Each of the 15 site keys must be migrated individually, and someone with the right reCAPTCHA Admin Console ownership *and* the right destination-project IAM role must perform it.
4. **Score/threshold behavior may shift slightly.** Migrated keys benefit from Google's broader risk models (more score granularity, refreshed detection signals). Google states existing integrations "continue to work without code changes," but your `> 0.5` threshold logic should be re-validated against real traffic post-migration rather than assumed unchanged, since the underlying model is not frozen.
5. **Downgrade risk.** If a billing issue causes a project to fall back to Essentials, you lose access to Premium/Enterprise-only features (basic reason codes, Policy Engine, etc.) and could hit the hard 10k org-wide ceiling with a 429 error and no automatic recovery until next month. This needs a monitoring/alerting story (Section 7), not just a one-time setup.
6. **GDPR role change.** Also as of April 2, 2026, Google's own role under reCAPTCHA shifted from *data controller* to **data processor** — meaning your company, as the site operator, is now explicitly the data controller responsible for user notices/legal basis regarding reCAPTCHA data collection. This is a legal/compliance action item (updating privacy policies), not just a technical one, and should be flagged to your legal/DPO function, especially given the EU user base.
7. **Fifteen separate change windows.** Even though each individual migration is fast, coordinating 15 application teams' testing/verification (even from one team, this is 15 separate app configs, CI pipelines, and environments to validate) is the primary source of elapsed calendar time, not the migration mechanics themselves.

### 3.3 Sources

- Billing information — free-tier pooling and examples — <https://docs.cloud.google.com/recaptcha/docs/billing-information>
- Quotas and limits (429 behavior) — <https://docs.cloud.google.com/recaptcha/quotas>
- Understand tier downgrades — <https://docs.cloud.google.com/recaptcha/docs/downgrades>
- Migrate from reCAPTCHA Classic (per-key process, required IAM roles) — <https://docs.cloud.google.com/recaptcha/docs/migrate-recaptcha>
- Create assessments for websites — authentication options for non-GCP environments — <https://docs.cloud.google.com/recaptcha/docs/create-assessment-website>
- Workload Identity Federation overview — <https://cloud.google.com/iam/docs/workload-identity-federation>
- reCAPTCHA and GDPR compliance (controller → processor change) — <https://cloud.google.com/blog/products/identity-security/recaptcha-enterprise-and-the-importance-of-gdpr-compliance>

---

## 4. Migration Process

### 4.1 Executive Summary

Migration is a console-driven, per-key operation that takes 5–10 minutes and requires **no application code changes**. For 15 apps, the practical work is sequencing: deciding the target project topology first (Section 5), enabling billing, migrating one low-traffic app as a pilot, validating dashboards and thresholds, then rolling out to the remaining 14 apps across dev → uat → prod.

### 4.2 Detailed Discussion

Two supported migration paths exist:

- **reCAPTCHA Admin Console (recommended by Google):** sign in to the classic Admin Console, select the destination Google Cloud project, select the site key(s), and submit. The console opens the migrated key inside Google Cloud automatically.
- **Google Cloud Console / `gcloud` / REST API:** for teams that want to script the operation (useful for 15 keys), the REST endpoint is:

```
POST <https://recaptchaenterprise.googleapis.com/v1/projects/PROJECT_ID/keys/SITE_KEY:migrate>
```

Example (curl), authenticated as a user/service account holding `roles/recaptchaenterprise.admin` or `roles/owner`/`roles/editor` on the destination project:

```bash
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "" \
  "<https://recaptchaenterprise.googleapis.com/v1/projects/PROJECT_ID/keys/SITE_KEY:migrate">
```

This is straightforward to wrap in a small script that loops over your 15 site keys and target projects — worth doing given the repetitive nature of the task.

**Preconditions per Google's documentation:**

- Billing must be enabled on the destination Google Cloud project (required for the migration call itself, and to move beyond Essentials afterward).
- The reCAPTCHA Enterprise API must be enabled on the destination project.
- The performing user account must be listed as an **owner** of the site key in the classic Admin Console, **and** hold `roles/recaptchaenterprise.admin` (or `roles/owner`/`roles/editor`) on the destination project.

**What does *not* change:** the site key value itself, your `<script src="<https://www.google.com/recaptcha/api.js?render=SITE_KEY">>` (or equivalent v3 bootstrap), your `grecaptcha.execute(siteKey, {action})` call, and your `ng-recaptcha-2` integration all continue to work unchanged. Usage becomes visible in the Google Cloud console dashboards within about one hour of migration; **usage prior to the migration is not backfilled**, so keep your existing v3 usage records/logs if you need historical comparison.

### 4.3 Implementation Steps

1. **Decide project topology first** (Section 5) — do not migrate keys before this is settled, since moving a key between projects afterward re-triggers IAM/dashboard setup.
2. **Enable billing** on every destination project (dev, uat, and each prod project) *before* migrating, so you land on Premium rather than Essentials and avoid a mid-migration 429.
3. **Enable the reCAPTCHA Enterprise API** (`recaptchaenterprise.googleapis.com`) on each destination project — this single API powers all tiers.
4. **Grant IAM roles** to the engineers performing the migration and to the CI/service identities that will call the assessment API afterward (Section 6).
5. **Pilot migration**: pick one low-traffic dev-environment app, migrate its key, and validate: (a) frontend still resolves tokens normally, (b) backend `createAssessment` calls still return expected scores, (c) the key appears with usage data in the Cloud Console within ~1 hour.
6. **Re-validate the score threshold** against a sample of real traffic post-migration before assuming `> 0.5` is still the right cut-off.
7. **Roll out to the remaining 14 apps**, environment by environment (dev → uat → prod), scripting the REST `:migrate` call where practical.
8. **Set up labels, dashboards, and budget alerts** (Section 7) as part of each app's rollout, not as an afterthought.
9. **Decommission classic-console access** for the migrated keys (revoke `roles/recaptchaenterprise.admin` from individual users if consolidating access via groups) once migration is verified stable.

### 4.4 Sources

- Migrate from reCAPTCHA Classic (full procedure, prerequisites, REST example) — <https://docs.cloud.google.com/recaptcha/docs/migrate-recaptcha>
- Use Fraud Defense features after migration — <https://docs.cloud.google.com/recaptcha/docs/using-features>
- Prepare your environment for Fraud Defense — <https://docs.cloud.google.com/recaptcha/docs/prepare-environment>
- Enable the reCAPTCHA Enterprise API (console/gcloud) — <https://docs.cloud.google.com/recaptcha/docs/migrate-recaptcha>
- Access control with IAM (roles required to migrate) — <https://docs.cloud.google.com/recaptcha/docs/access-control>

---

## 5. Environments: Separating Dev/UAT from Production

### 5.1 Executive Summary

Dev and UAT should never share a reCAPTCHA key, billing scope, or IAM footprint with production. This protects production's free-tier headroom from being consumed by test/CI traffic, keeps production fraud-score data uncontaminated by synthetic test traffic, and lets you apply looser (or bypassed) verification in lower environments without any production risk. The recommended shape, balancing your goal of easy cost/usage monitoring against avoiding project sprawl, is **three Google Cloud projects — one per environment tier (dev, uat, prod) — each containing one reCAPTCHA key per application, distinguished by resource labels**, rather than 45 separate per-app-per-environment projects or a single shared project as today.

### 5.2 Detailed Discussion

**Why not keep one shared project (today's model)?** A single project pools all 15 apps' billing, quota, IAM, and free-tier usage together with no built-in separation — this is exactly the visibility problem you're trying to solve, and it gets worse once dev/uat traffic (often noisier and more automatable, e.g. via CI/E2E test runs) is mixed with production's.

**Why not 45 projects (15 apps × 3 environments)?** This maximizes isolation (per-project quotas, dashboards, and IAM), but for a single team maintaining all 15 apps, it multiplies administrative overhead — 45 sets of billing/IAM/API-enablement to keep consistent — for a benefit (perfect isolation) you don't fully need, since your monitoring goal (Section 7) can be met with labels instead of hard project boundaries. The org-wide free-tier pooling described in Section 3 also means splitting into more projects does **not** buy you more free assessments; the 10,000/month ceiling is per organization regardless of project count.

**Recommended model — 3 projects, labeled keys:**

```
Organization
├── recaptcha-dev-<company>      (Essentials or Premium; billing optional depending on CI volume)
│     ├── key: app-01-web  [labels: app=app-01, env=dev]
│     ├── key: app-02-web  [labels: app=app-02, env=dev]
│     └── ... (15 keys)
├── recaptcha-uat-<company>      (Premium; billing enabled)
│     └── ... (15 keys, same labeling convention)
└── recaptcha-prod-<company>     (Premium, or Enterprise if volume warrants; billing enabled, stricter IAM)
      └── ... (15 keys, same labeling convention)
```

This gives you:

- **Hard separation of prod from non-prod** at the project level — a compromised or misconfigured CI job in dev/uat cannot affect production quota, billing, or IAM.
- **Per-app granularity for cost/usage** via labels + Cloud Billing export (Section 7), without paying the administrative cost of 45 projects.
- **Simple IAM story**: grant the whole engineering team `roles/recaptchaenterprise.agent` in dev/uat for fast iteration, and restrict `roles/recaptchaenterprise.admin` in prod to a small group, with CI/CD service accounts scoped per-project rather than per-app.
- **A natural place to apply different policy**: e.g., disable score-based blocking or lower confidence thresholds in dev/uat, use Policy Engine rules (Premium/Enterprise) only in prod, and keep prod's Looker Studio dashboards and alerting free of test noise.

**Site keys must be domain-restricted per environment.** Each key is bound to the domains it's installed on (e.g., `app01-dev.internal.company.com`, `app01-uat.company.com`, `app01.company.com`) — this is enforced by Google and is your primary technical guarantee that a dev key can't accidentally be used against production traffic or vice-versa, independent of the project split above.

**If you later want tighter isolation for a specific high-risk app** (e.g., a payment-related application), nothing prevents pulling that single app's prod key into its own dedicated project later — the 3-project model is a sensible default, not a hard ceiling.

### 5.3 Implementation Steps

1. Create `recaptcha-dev`, `recaptcha-uat`, `recaptcha-prod` Google Cloud projects (or equivalent naming per your existing project-naming convention).
2. Enable billing on `uat` and `prod` immediately; decide for `dev` based on expected CI/test traffic (Essentials may suffice if dev traffic is low and synthetic tests can tolerate occasional 429s).
3. Enable the reCAPTCHA Enterprise API on all three projects.
4. For each of the 15 apps, create one score-based key per environment, each domain-restricted to that environment's hostname(s).
5. Apply consistent labels to every key: `app=<app-id>`, `env=<dev|uat|prod>`, `team=<owning-team>` (Section 7 defines the labeling scheme in full).
6. Store the resulting site keys in each app's existing environment configuration mechanism (the same place `.env`/config files already hold the current per-environment v3 keys) — no new configuration pattern is required.
7. Confirm domain restrictions reject cross-environment use (e.g., attempt to load the dev key on the prod domain and confirm it's rejected).

### 5.4 Sources

- Create keys for websites (domain restriction) — <https://docs.cloud.google.com/recaptcha/docs/create-key-website>
- Usage reporting using labels — <https://docs.cloud.google.com/recaptcha/docs/labels>
- Access control with IAM — <https://docs.cloud.google.com/recaptcha/docs/access-control>
- Billing information (free tier pooled at organization level) — <https://docs.cloud.google.com/recaptcha/docs/billing-information>
- Configure challenge policies / Policy Engine (env-specific policy) — <https://docs.cloud.google.com/recaptcha/docs/policy-engine>
- Google Cloud resource hierarchy best practices — <https://cloud.google.com/architecture/best-practices-for-enterprise-organizations>

---

## 6. IAM Roles and Service Accounts

### 6.1 Executive Summary

reCAPTCHA (Sept 2026) ships three predefined IAM roles — Admin, Agent, and Viewer — that map cleanly onto "who configures keys," "what calls the assessment API," and "who can look at dashboards without touching config." Because your backend runs on-prem, the service account your Node.js service uses is not automatically available the way it would be on Cloud Run/GKE; you must explicitly provision either a downloaded service-account key or, preferably, Workload Identity Federation.

### 6.2 Detailed Discussion

**Predefined roles:**

- **Admin** — role id `roles/recaptchaenterprise.admin`. Create/modify/delete keys, manage firewall/challenge policies, view metrics. Typical holder: a small group of senior engineers/platform team per environment (especially prod).
- **Agent** — role id `roles/recaptchaenterprise.agent`. Create and annotate assessments (i.e., call the verification API). Typical holder: the backend service account(s) used by your Node.js services.
- **Viewer** — role id `roles/recaptchaenterprise.viewer`. Read-only: view keys, policies, and metrics. Typical holder: broader engineering team, support/on-call staff, dashboard-only users.

Custom roles are also supported if you need something between these (e.g., regulatory requirement for a narrower permission set).

**Service account model for your topology.** Following the three-project layout from Section 5, a clean pattern is:

- One dedicated service account per environment, named e.g. `recaptcha-agent`, created inside the corresponding `recaptcha-prod` / `recaptcha-uat` / `recaptcha-dev` project, and granted `roles/recaptchaenterprise.agent` on that project only.
- All 15 apps' backends in that environment use the *same* environment-scoped service account to call `createAssessment` — you don't need one service account per app unless you want per-app audit trails (Cloud Audit Logs already record the calling principal + the specific key/project regardless).
- `roles/recaptchaenterprise.admin` is **not** given to this service account — key/policy management stays a human, admin-console/Terraform-driven action, following least privilege.

**On-prem authentication — the key architectural decision.** Because your backend is on-prem (not GKE/Cloud Run/GCE), there is no Application Default Credentials metadata server to lean on. Google documents two supported approaches for non-GCP environments:

1. **Service account JSON key file.** Simplest to implement — set the environment variable `GOOGLE_APPLICATION_CREDENTIALS` to the path of the downloaded key file — but it's a long-lived static secret: it must be stored in your existing on-prem secrets manager, rotated periodically, and excluded from source control/images. This is the higher-risk, lower-effort option.
2. **Workload Identity Federation (WIF) — recommended.** Lets your on-prem identity provider (e.g., an existing SAML/OIDC IdP, or a self-hosted OIDC token issuer) exchange a short-lived token for temporary Google credentials, with **no long-lived Google key material stored on-prem at all**. This is more setup work up front (configuring a workload identity pool and provider per project) but eliminates a class of credential-leak risk and is Google's current recommended pattern for hybrid/on-prem workloads calling Google Cloud APIs.

Given you have 15 apps behind presumably a smaller number of shared backend services, WIF is worth the one-time setup investment rather than distributing 15 sets of static JSON keys across on-prem infrastructure.

**API keys as a fallback.** Google also supports plain API keys as an authentication method for the assessment-creation REST call from non-GCP environments. This avoids service-account plumbing entirely but is the weakest option from a security standpoint (a bearer credential with no attached identity/audit principal) and should be restricted (HTTP referrer / IP allow-listing on the API key) if used at all. Recommended only as a stopgap before WIF is in place, not as the end state.

### 6.3 Implementation Steps

1. Create one `recaptcha-agent` service account per environment project (`dev`, `uat`, `prod`).
2. Grant `roles/recaptchaenterprise.agent` to each service account, scoped to its own project only.
3. Grant `roles/recaptchaenterprise.admin` to a named, small group (e.g., a Google Group mapped to your platform/security engineers) per project — narrower in prod than in dev/uat.
4. Grant `roles/recaptchaenterprise.viewer` broadly to the engineering team for dashboard/metric visibility without config rights.
5. Stand up Workload Identity Federation from your on-prem IdP to each of the three projects; issue short-lived credentials to the Node.js backend at runtime instead of a static key file.
6. If WIF cannot be delivered before the migration deadline, use a service-account JSON key as an interim step, stored in your existing on-prem secret manager with a documented rotation schedule, and track WIF as immediate follow-up work.
7. Confirm Cloud Audit Logs capture `createAssessment` calls with the correct calling identity for each environment (validates the IAM setup end-to-end).

### 6.4 Sources

- Access control with IAM (roles and permissions table) — <https://docs.cloud.google.com/recaptcha/docs/access-control>
- Create assessments for websites (authentication method table by environment) — <https://docs.cloud.google.com/recaptcha/docs/create-assessment-website>
- Workload Identity Federation — <https://cloud.google.com/iam/docs/workload-identity-federation>
- Workload Identity Federation for on-premises/hybrid workloads — <https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines>
- API keys best practices (restrictions) — <https://cloud.google.com/docs/authentication/api-keys>
- Audit logging for reCAPTCHA — <https://docs.cloud.google.com/recaptcha/docs/audit-logging>

---

## 7. Monitoring: Cost, Usage Volume, and Success/Failure Ratios per Project

### 7.1 Executive Summary

reCAPTCHA (Sept 2026) gives you three complementary, official monitoring surfaces: (1) built-in Cloud Billing reports for cost, (2) the Google Cloud console's usage dashboard and Cloud Monitoring metrics for volume, and (3) exportable platform logs feeding BigQuery + a pre-built Looker Studio template for score distributions and success/failure ratios. The single most important setup step is **applying consistent labels to every key**, since labels are what let you break all of this down per application rather than seeing one undifferentiated number per project.

### 7.2 Detailed Discussion

**Labels are the foundation.** A label is a key-value pair attached to a reCAPTCHA key (up to 64 per resource). Labels propagate into the Cloud Billing system, so billing reports and billing data exports can be filtered/grouped by label. Recommended scheme for your estate:

```
app: app-01            # stable application identifier, one per app
env: prod               # dev | uat | prod
team: platform          # owning team (useful if this changes later)
tier: premium           # optional: track which billing tier a key is on
```

**Cost monitoring.** With labels in place:

- Use built-in **Cloud Billing reports** (console) filtered/grouped by the `app` and `env` labels for a fast, no-setup view of spend per application and environment.
- For deeper analysis (trend lines, forecasting, chargeback to app-owning teams), enable **Cloud Billing data export to BigQuery** and query/aggregate by label — this is the same mechanism used for all Google Cloud cost attribution, not something reCAPTCHA-specific, so it likely fits into any FinOps tooling you already have.
- Set **budget alerts** per environment project (and optionally per label via a custom BigQuery-fed alert) so a runaway app is caught before it materially affects the monthly bill, not after.

**Usage volume monitoring.** Two layers:

- The reCAPTCHA page in the Google Cloud console includes a **feature usage dashboard** showing billed assessments over the last 30 days per key/project — good for a quick daily/weekly check with zero setup.
- **Cloud Monitoring** exposes reCAPTCHA metrics (`monitoring.timeSeries.list` permission, included in both Admin and Viewer roles) that can be wired into existing dashboards/alerting (e.g., Grafana via the Cloud Monitoring API, or native Cloud Monitoring dashboards) alongside your other application metrics.

**Success/failure ratio and score distribution.** This is where **platform logs → BigQuery → Looker Studio** matters:
1. Enable platform logging for assessment operations on each key/project.
2. Create a BigQuery sink into a new, partitioned BigQuery dataset (standard Cloud Logging → BigQuery export pattern).
3. Open Google's pre-built **Looker Studio dashboard template** for reCAPTCHA, point it at your BigQuery dataset, and you get out-of-the-box visualizations of scraping/ATO/payment-fraud protection effectiveness, score distributions, and (once you compute it in a view) your pass/fail ratio against the `> 0.5` threshold — per label, i.e., per app and per environment.
4. Dashboards can be scheduled as email/PDF/PNG reports — useful for the manager-facing side of ongoing monitoring, separate from this document.

**Quota vs. cost — two different alarms.** Don't conflate "am I about to pay more" (billing alert) with "am I about to get 429s" (quota alert, relevant mainly for Essentials-tier or org-wide free-tier exhaustion) — both should be monitored, but they trigger on different thresholds and call for different responses (the former is a FinOps conversation; the latter is an incident).

### 7.3 Implementation Steps

1. Apply the `app` / `env` / `team` label scheme (Section 5.3) to every key at creation time — retrofitting labels later works but loses historical breakdown for the period before they were added.
2. Turn on Cloud Billing data export to BigQuery for the billing account covering all three reCAPTCHA projects (a one-time, org-level setup if not already in place for other GCP spend).
3. Build (or reuse existing) Looker Studio / BigQuery views that group cost and assessment counts by `app` and `env` labels.
4. Enable platform logs for assessment operations on each key; sink to a partitioned BigQuery dataset.
5. Import Google's Looker Studio reCAPTCHA dashboard template against that dataset; add a computed pass/fail ratio field.
6. Configure Cloud Billing budget alerts per environment project, and quota-proximity alerts (e.g., via Cloud Monitoring alerting policies on assessment volume) ahead of the 10,000/month org-wide free-tier ceiling.
7. Grant `roles/recaptchaenterprise.viewer` to whoever needs read access to these dashboards without needing key-management rights.

### 7.4 Sources

- Usage reporting using labels — <https://docs.cloud.google.com/recaptcha/docs/labels>
- Billing reports and cost trends — <https://docs.cloud.google.com/billing/docs/how-to/reports>
- Cloud Billing data export to BigQuery — <https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery>
- Monitor reCAPTCHA keys — <https://docs.cloud.google.com/recaptcha/docs/monitor-keys>
- Work with platform logs — <https://docs.cloud.google.com/recaptcha/docs/platform-logging>
- Create dashboards with Looker Studio — <https://docs.cloud.google.com/recaptcha/docs/looker>
- Access control with IAM (viewer role, `monitoring.timeSeries.list`) — <https://docs.cloud.google.com/recaptcha/docs/access-control>

---

### 7.5 Detailed Reports and Alerts: Per Environment and Per App

This subsection expands on 7.1–7.4 with a full walkthrough of how reporting and alerting layer onto the three-project topology from Section 5 (`recaptcha-dev`, `recaptcha-uat`, `recaptcha-prod`, each holding one key per app carrying `app` / `env` / `team` labels), split explicitly by what is naturally **per-environment** (project-level) versus what requires the app label to break down **per app within an environment**.

#### The core mechanism: labels flow everywhere

Every signal below — billing, quota metrics, logs — carries the `app` / `env` / `team` labels set on each key. That is what makes "per app within an environment" possible without 45 separate projects: the project boundary gives you environment-level isolation, and labels give you app-level breakdown *within* that boundary.

#### Reports

**Per-environment (project-level, zero setup):**

- **Cloud Billing reports** in the console, scoped to the `recaptcha-dev` / `uat` / `prod` project — cost trend, no configuration needed.
  Docs: <https://docs.cloud.google.com/billing/docs/how-to/reports>
- **reCAPTCHA's own usage dashboard** in the Cloud Console — assessment volume per key over the last 30 days.
  Docs: <https://docs.cloud.google.com/recaptcha/docs/monitor-keys>

**Per-app within an environment (requires labels + export):**

1. Enable **Cloud Billing data export to BigQuery** for the billing account covering all three projects.
   Docs: <https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery>
2. Query/group by the `app` label in BigQuery — this gives you cost per app per environment, something the console UI alone can't slice.
3. Enable **reCAPTCHA platform logs** per key and sink them to BigQuery (standard Cloud Logging → BigQuery export).
   Docs: <https://docs.cloud.google.com/recaptcha/docs/platform-logging>
4. Import Google's **Looker Studio dashboard template**, pointed at that BigQuery dataset, with a filter control on the `app` label — this is what gives you score distribution and success/failure ratio per app, not just per project.
   Docs: <https://docs.cloud.google.com/recaptcha/docs/looker>

Practically: build one Looker Studio report per environment (matching the project boundary), with an `app` dropdown filter inside each — rather than 45 separate dashboards.

#### Alerts

Two distinct alert types, on different signals, both scoped the same way (project = environment, label = app):

**1. Cost alerts — Cloud Billing budgets**

- One budget per environment project (`recaptcha-dev`, `uat`, `prod`), each with its own threshold and notification channel — this is inherently per-environment, since Cloud Billing budgets scope to a project (or billing account), not to a label.
- For **per-app** cost alerting, budgets alone can't filter by label — instead, schedule a query against your BigQuery billing export grouped by `app`, and route the result through a Cloud Monitoring alerting policy or a scheduled function/notification (see below).
  Docs: <https://docs.cloud.google.com/billing/docs/how-to/budgets>

**2. Volume / quota / error-rate alerts — Cloud Monitoring alerting policies**

- reCAPTCHA assessment metrics are exposed to Cloud Monitoring and can be filtered by resource labels (including your `app` label), so **one alerting policy per environment project can still fire per-app**, as long as the policy's condition groups/filters by the `app` label rather than aggregating the whole project.
  Docs: <https://docs.cloud.google.com/monitoring/alerts>
- For anything derived from the *content* of platform logs (e.g., a spike in `INVALID_TOKEN` or a specific `riskAnalysis.reasons` code for one app), create a **log-based metric** filtered on that log field, then attach an alerting policy to it. Log-based metrics inherit whatever labels you extracted from the log entry, so this is the most flexible route for genuinely per-app alerting.
  Docs: <https://docs.cloud.google.com/logging/docs/logs-based-metrics>
- Wire policies to **notification channels** (email, Slack, PagerDuty, Pub/Sub, webhook) — the same channel types work whether the policy is environment-wide or app-scoped.
  Docs: <https://docs.cloud.google.com/monitoring/support/notification-options>
- The quota-specific case from Sections 3 and 7.2 — approaching the org-wide 10,000/month free-tier ceiling — is best watched with an alerting policy on the assessment-volume metric, aggregated at whichever level matters most: environment-wide, since the ceiling itself is org-wide; or per-app, if you want early warning on which app is driving the trend.

#### Putting it together

| Layer | Per-environment | Per-app-in-environment |
|---|---|---|
| Cost report | Billing console (project-scoped) | BigQuery billing export grouped by `app` label |
| Cost alert | Budget per project | Scheduled BigQuery query + Monitoring policy |
| Volume report | reCAPTCHA console dashboard | Looker Studio + `app` filter |
| Volume/quota alert | Monitoring policy on project metric | Monitoring policy filtered/grouped by `app` label |
| Score/error-rate report | Looker Studio (project dataset) | Same dashboard, `app` filter |
| Score/error-rate alert | Log-based metric + policy (project-wide filter) | Log-based metric + policy (label-filtered) |

The one-time setup cost is the BigQuery export, the Looker Studio template, and a handful of alerting policies **per environment project** (three times total, not fifteen times per app) — app-level granularity comes from filtering/grouping by label within that shared setup, not from duplicating infrastructure per app.

#### Sources

- Billing reports and cost trends — <https://docs.cloud.google.com/billing/docs/how-to/reports>
- Monitor reCAPTCHA keys — <https://docs.cloud.google.com/recaptcha/docs/monitor-keys>
- Cloud Billing data export to BigQuery — <https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery>
- Work with platform logs — <https://docs.cloud.google.com/recaptcha/docs/platform-logging>
- Create dashboards with Looker Studio — <https://docs.cloud.google.com/recaptcha/docs/looker>
- Cloud Billing budgets and alerts — <https://docs.cloud.google.com/billing/docs/how-to/budgets>
- Cloud Monitoring alerting overview — <https://docs.cloud.google.com/monitoring/alerts>
- Log-based metrics overview — <https://docs.cloud.google.com/logging/docs/logs-based-metrics>
- Create and manage notification channels — <https://docs.cloud.google.com/monitoring/support/notification-options>
- Usage reporting using labels — <https://docs.cloud.google.com/recaptcha/docs/labels>

---

## 8. Frontend Theory and Implementation (Angular 21, Standalone Components)

### 8.1 Executive Summary

The frontend integration does not need to change at migration time — the same token-retrieval call your 15 apps already make continues to work against a migrated key. The main forward-looking decision is whether to keep `ng-recaptcha-2` as-is (fine, see Section 11) or adopt Google's official `grecaptcha.enterprise.execute()` JS API directly, which unlocks a couple of Enterprise-only client-side capabilities (e.g., the ability to pass a `siteKey` explicitly per call and slightly different loader parameters). For a standalone-components, zone.js-based Angular 21 codebase, both paths are straightforward.

### 8.2 Detailed Discussion

**How scoring works today (v3, via `ng-recaptcha-2`):**

```ts
// app.config.ts (standalone bootstrap)
import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { RECAPTCHA_V3_SITE_KEY, RecaptchaV3Module } from 'ng-recaptcha-2';

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(RecaptchaV3Module),
    { provide: RECAPTCHA_V3_SITE_KEY, useValue: 'YOUR_SITE_KEY' },
  ],
};
```

```ts
// some-standalone.component.ts
import { Component, inject } from '@angular/core';
import { ReCaptchaV3Service } from 'ng-recaptcha-2';

@Component({ selector: 'app-checkout', standalone: true, template: `...` })
export class CheckoutComponent {
  private recaptchaV3Service = inject(ReCaptchaV3Service);

  submit(): void {
    this.recaptchaV3Service.execute('submit_form').subscribe((token) => {
      // send `token` to your Node.js backend, same as today
    });
  }
}
```

**What migration changes here: nothing, functionally.** The site key you plug into `RECAPTCHA_V3_SITE_KEY` is simply swapped for the migrated key's value (per environment, per Section 5); the loader script Google serves and the token format are unchanged for score-based key types, which is exactly what your apps already use.

**What migration makes *possible*, if you choose to adopt it later:**

- **The official `grecaptcha.enterprise.execute()` global**, loaded via `<https://www.google.com/recaptcha/enterprise.js?render=SITE_KEY`> instead of `api.js`. This is a drop-in swap of the script URL and global namespace; `ng-recaptcha-2`, as a fork frozen around the classic `api.js` loader, does not currently emit this URL, so using it means either configuring a custom script loader in the library (if exposed) or writing a small, framework-idiomatic Angular service around the native API (a handful of lines — see Section 11.3).
- **Explicit per-call `siteKey` and `action` payloads sent to the assessment API**, which the backend can validate matches the expected key/action (defense against token replay across apps) — a backend-side improvement, not something the frontend needs to change to support beyond what it already sends.

**Standalone components / zone.js considerations.** `ReCaptchaV3Service.execute()` returns an RxJS `Observable`; nothing about Angular 21 standalone components or zone.js changes this contract. If any of the 15 apps have started adopting zoneless change detection ahead of a broader Angular migration, note that `ng-recaptcha-2` (as a fork of the original `ng-recaptcha`) was not written with zoneless change detection specifically in mind — the Google script's own callback runs outside Angular's zone by nature (it's a third-party `<script>`), so this has always required `NgZone.run()`-style wrapping internally; validate this still works correctly if/when any app removes zone.js, independent of the reCAPTCHA migration itself.

**Badge and Content-Security-Policy notes.** The reCAPTCHA v3 floating badge and its `unsafe-inline`/`google.com` CSP requirements are unaffected by migration — no new CSP directives are required unless you switch the script source to `enterprise.js`.

### 8.3 Implementation Steps

1. Keep `ng-recaptcha-2` and existing component code unchanged for the initial migration; only the injected site-key value changes per environment.
2. Confirm each app's `RECAPTCHA_V3_SITE_KEY` provider is sourced from environment configuration (not hardcoded) so the per-environment keys from Section 5 can be swapped without a code change per app.
3. After migration is stable, evaluate (as a separate, optional follow-up) whether to adopt `grecaptcha.enterprise.execute()` directly for the explicit `siteKey`/`action` validation benefit — see Section 11.3 for a reference implementation.
4. Re-run each app's existing reCAPTCHA-related end-to-end/integration tests against the migrated dev key before promoting to uat/prod.
5. If any app is on a zoneless-change-detection track, add an explicit regression test for the resolved-token callback path before combining that migration with this one.

### 8.4 Sources

- Install score-based keys on web pages — <https://docs.cloud.google.com/recaptcha/docs/instrument-web-pages>
- Action names — <https://docs.cloud.google.com/recaptcha/docs/actions-website>
- Migrate from reCAPTCHA Classic (frontend unaffected) — <https://docs.cloud.google.com/recaptcha/docs/migrate-recaptcha>
- ng-recaptcha-2 (GitHub) — <https://github.com/LakhveerChahal/ng-recaptcha-2>
- Angular standalone components guide — <https://angular.dev/guide/components/importing>
- Angular zoneless change detection guide — <https://angular.dev/guide/zoneless>

---

## 9. Backend Theory and Implementation (Node.js, On-Premises)

### 9.1 Executive Summary

Your current backend flow — receive a token, call Google, read back a score — stays conceptually identical. What changes is *how* the backend authenticates and *which* endpoint/library it calls: instead of an unauthenticated form POST to `siteverify`, the backend now calls the authenticated `projects.assessments.create` API (REST or the official Node.js client library), using a Google-issued credential rather than a shared secret key.

### 9.2 Detailed Discussion

**Today's flow (classic v3):**

```
POST <https://www.google.com/recaptcha/api/siteverify>
  secret=<SECRET_KEY>&response=<TOKEN>
→ { success: true, score: 0.9, action: "submit", ... }
```

No Google authentication is involved — the shared secret key *is* the credential, and any server that has it can call this endpoint.

**The new flow (reCAPTCHA (Sept 2026) / Enterprise API):**

```
POST <https://recaptchaenterprise.googleapis.com/v1/projects/PROJECT_ID/assessments>
  Authorization: Bearer <GOOGLE-ISSUED ACCESS TOKEN>
  { "event": { "token": "<TOKEN>", "siteKey": "<SITE_KEY>", "expectedAction": "submit_form" } }
→ { "tokenProperties": { "valid": true, "action": "submit_form" }, "riskAnalysis": { "score": 0.9, "reasons": [...] } }
```

The credential is now a first-class Google identity (service account via key file or Workload Identity Federation, per Section 6), not a bare secret string — this is the single biggest conceptual shift for the backend team.

**Recommended: the official Node.js client library**, which wraps the REST call, handles auth token refresh automatically given standard Google credential resolution, and gives you typed request/response objects:

```bash
npm install @google-cloud/recaptcha-enterprise
```

```js
const { RecaptchaEnterpriseServiceClient } = require('@google-cloud/recaptcha-enterprise');

// With a service-account key file or Workload Identity Federation configured
// via GOOGLE_APPLICATION_CREDENTIALS, the client resolves credentials automatically.
const client = new RecaptchaEnterpriseServiceClient();

async function verifyToken({ token, siteKey, expectedAction, projectNumber }) {
  const projectPath = client.projectPath(projectNumber);

  const [response] = await client.createAssessment({
    parent: projectPath,
    assessment: {
      event: { token, siteKey, expectedAction },
    },
  });

  if (!response.tokenProperties.valid) {
    // Token invalid or expired: treat as failed verification
    return { success: false, reason: response.tokenProperties.invalidReason };
  }

  if (response.tokenProperties.action !== expectedAction) {
    // Action mismatch: possible token replay from a different flow
    return { success: false, reason: 'ACTION_MISMATCH' };
  }

  const score = response.riskAnalysis.score;
  return { success: score > 0.5, score, reasons: response.riskAnalysis.reasons };
}

module.exports = { verifyToken };
```

Notes on this compared to your current code:

- `expectedAction` / `tokenProperties.action` gives you a **replay/cross-flow check for free** that classic `siteverify` did not surface as cleanly — worth adding to your verification logic, not just swapping endpoints.
- `riskAnalysis.reasons` (Premium/Enterprise tiers) gives human-readable reason codes (e.g., `AUTOMATION`, `UNEXPECTED_ENVIRONMENT`) that are valuable for logging/observability even if you keep the same `> 0.5` pass/fail cutoff.
- Your `> 0.5` threshold logic can stay as-is initially; re-validate it (Section 4.3, step 6) rather than assume it transfers perfectly, since risk models evolve.

**On-prem authentication, concretely.** Since the backend is not running on Google Cloud infrastructure, `RecaptchaEnterpriseServiceClient()` needs an explicit credential source:

- **Simplest (interim):** point the `GOOGLE_APPLICATION_CREDENTIALS` environment variable at a securely-stored key file, with the JSON key issued to the `recaptcha-agent` service account from Section 6, stored in your existing on-prem secrets manager (e.g., Vault, or whatever the team already uses) and injected at process start — never baked into an image or committed to source control.
- **Recommended (target state): Workload Identity Federation.** The client library supports loading an *external account credential configuration* (a small JSON pointing at your on-prem OIDC/SAML token source) instead of a static key, via the same `GOOGLE_APPLICATION_CREDENTIALS` environment variable pointing at a WIF config file rather than a service-account key. This removes the long-lived-secret problem entirely; the extra setup is a one-time cost shared across all 15 apps if the backend is a shared service, or replicated per backend deployment unit if not.
- **API-key based REST calls** remain possible for teams that don't want to adopt the client library or WIF immediately, but this is the least secure option (Section 6.2) and is not recommended as a long-term pattern for a security-relevant control like fraud scoring.

**Backend code structure recommendation.** Given 15 apps sharing this pattern, centralize the `verifyToken`-style function into a small shared internal package (or a shared verification microservice, if your backend architecture already leans that way) so the auth/credential/threshold logic lives in one place rather than being copy-pasted 15 times — this also makes future threshold or reason-code-handling changes a one-place edit instead of a 15-app rollout.

### 9.3 Implementation Steps

1. Add `@google-cloud/recaptcha-enterprise` to the shared backend dependency set (or the relevant service if verification logic is centralized).
2. Implement credential resolution per Section 6 (service-account key as interim, WIF as target) and confirm `RecaptchaEnterpriseServiceClient()` picks it up correctly in a non-GCP process.
3. Replace the `siteverify` HTTP call with `createAssessment`, including `expectedAction` validation and structured logging of `riskAnalysis.reasons`.
4. Keep the existing `> 0.5` pass/fail decision initially; add a metric/log line capturing score distribution so the threshold can be re-tuned with real post-migration data.
5. Centralize this logic in one shared module/service consumed by all 15 apps' backends rather than duplicating per app.
6. Add error handling for `RESOURCE_EXHAUSTED` (429, quota/free-tier exceeded) distinct from `INVALID_ARGUMENT`/token-invalid errors, since these require different operational responses (Section 7).
7. Load-test the new authenticated call path (added network hop + Google auth token exchange) to confirm latency is acceptable for your request budgets, especially the first request after a credential/token refresh.

### 9.4 Sources

- Create assessments for websites (REST contract, auth method table) — <https://docs.cloud.google.com/recaptcha/docs/create-assessment-website>
- Interpret assessments for websites (score, action mismatch, reasons) — <https://docs.cloud.google.com/recaptcha/docs/interpret-assessment-website>
- Node.js client library reference and quickstart — <https://docs.cloud.google.com/nodejs/docs/reference/recaptcha-enterprise/latest>
- `@googleapis/recaptchaenterprise` (legacy — points to `@google-cloud/recaptcha-enterprise` as the recommended library) — <https://www.npmjs.org/package/@googleapis/recaptchaenterprise>
- Workload Identity Federation — <https://cloud.google.com/iam/docs/workload-identity-federation>
- Quotas and limits (429 handling) — <https://docs.cloud.google.com/recaptcha/quotas>

---

## 10. Costs

### 10.1 Executive Summary

At the volumes you're likely to see per application (10k–100k/month), reCAPTCHA (Sept 2026) on the **Premium** tier costs either **nothing** or a **flat $8/month** per application, versus **effectively free today** on classic v3 (which, prior to April 2026, had a much larger free allowance). The financial delta only becomes material above ~100,000 assessments/month per app, where Premium bills $1 per additional 1,000. The real cost lever is architectural, not tariff-related: because the free 10,000/month allowance is shared across your *entire organization*, the number of assessments you generate per page load matters more than which pricing tier you're on — see the optimization tips below.

### 10.2 Cost Model — Classic reCAPTCHA v3 (what you have today)

Classic v3 site keys, prior to the April 2026 restructuring, historically operated with a very high free monthly ceiling (widely reported at 1,000,000 assessments/month) and no requirement to attach a Google Cloud billing account at all. **Important caveat:** Google can no longer create new classic keys, and classic keys' free allowance is understood to now be governed by the same organization-wide rules described in Section 1/3 once any part of your org has billing-linked reCAPTCHA usage — in practice, for a company already planning this migration, the old "1M free" classic model should be treated as **legacy and not a reliable planning baseline going forward**, which is itself one more reason to migrate deliberately rather than delay: staying on classic does not guarantee retaining the old, larger free tier indefinitely.

### 10.3 Cost Model — reCAPTCHA (Sept 2026), Premium Tier

| Monthly assessments (org-wide) | Cost |
|---|---|
| 0 – 10,000 | Free |
| 10,001 – 100,000 | $8.00 flat fee for the month |
| Above 100,000 | $8.00 + $0.001 per assessment over 100,000 ($1.00 per 1,000) |

No separate charge exists for reCAPTCHA Essentials (always free, capped at 10,000/month org-wide, no billing account). Enterprise-tier pricing is contract-based ($1/1,000 with a volume commitment and 12-month minimum) and is covered separately in 10.4.

### 10.4 Cost Model — reCAPTCHA Enterprise Tier (contract-based, for reference)

Enterprise is **not** the default outcome of migration — it requires contacting Google Cloud Sales and committing to a 12-month subscription — but is worth understanding as a future option: fixed monthly volume commitment at $1 per 1,000 assessments, plus access to dedicated account management, advanced analytics, and customer-specific fraud reports not available on Premium. This becomes attractive mainly if (a) your combined volume across all 15 apps grows large enough that predictable, committed pricing beats pay-as-you-go, or (b) you need the Enterprise-only features (Related Accounts API, API-only transaction defense, dedicated account manager) rather than for the pricing alone.

### 10.5 Cost Comparison and Scenarios

Your 15 applications share one classic v3 key today, so there is no current per-app cost baseline to compare against — this section instead models the requested scenarios, **per application, per month**, on the Premium tier (the realistic target of this migration):

| Assessments/month (per app) | Premium tier cost (per app) | Notes |
|---|---|---|
| 10,000 | **$0** | Falls entirely within free allowance — *if* no other app in the org has already consumed the shared 10,000/month org-wide pool that month |
| 20,000 | **$8.00** | First 10k free, remaining 10k billed at the flat $8 rate (flat fee applies for any volume between 10,001 and 100,000) |
| 50,000 | **$8.00** | Still within the flat-fee band (10,001–100,000) |
| 100,000 | **$8.00** | Top of the flat-fee band |

**Critical point for a 15-app estate:** these numbers assume each app is evaluated as if it had its own private free allowance, which is **not how billing actually works** — the 10,000/month free allowance is pooled at the *organization* level, not per app or per project. In practice, once your combined traffic across 15 apps exceeds 10,000 assessments/month (which is likely even at low per-app volumes), **only the first 10,000 org-wide are free each month**, and the flat $8 fee (or per-1,000 overage) applies per project once that project's own usage pushes past its share. The table below shows the more realistic **organization-wide** picture, assuming all 15 apps run the same per-app volume in the **same** environment/project (e.g., all-prod):

| Per-app volume | Org-wide total (×15 apps) | Approx. monthly cost if pooled in ONE prod project | Approx. monthly cost if spread across separate per-app keys in the SAME project |
|---|---|---|---|
| 10,000 | 150,000 | $8 (flat) + $0.001 × 50,000 = **$58.00** | Same — billing is per-project, not per-key, so splitting into keys within one project does not change project-level cost |
| 20,000 | 300,000 | $8 + $0.001 × 200,000 = **$208.00** | Same |
| 50,000 | 750,000 | $8 + $0.001 × 650,000 = **$658.00** | Same |
| 100,000 | 1,500,000 | $8 + $0.001 × 1,400,000 = **$1,408.00** | Same |

*(Billing is calculated per Google Cloud project, not per key — so whether you use one key or 15 keys within the same `recaptcha-prod` project, per Section 5's recommended topology, the project-level bill is the same; the value of separate keys/labels is cost **attribution**, not cost **reduction**.)*

**Approximate EUR equivalents.** Using an indicative rate of **1 USD ≈ 0.87 EUR** (EUR/USD has traded roughly in the 1.13–1.18 range through mid-2026; check a live rate before using these for budget approval, as this fluctuates):

| Org-wide monthly cost (USD) | Approx. EUR |
|---|---|
| $58.00 | ≈ €50 |
| $208.00 | ≈ €181 |
| $658.00 | ≈ €572 |
| $1,408.00 | ≈ €1,225 |

**Takeaway for planning purposes:** even at a relatively high 100,000 assessments/month/app across all 15 production apps (1.5M assessments/month org-wide), the Premium-tier bill is roughly **$1,400/month (~€1,225)** — modest for most engineering budgets, but worth setting a budget alert around (Section 7) given it scales linearly and can grow silently if per-page assessment volume creeps up (see 10.6).

### 10.6 Tips to Minimize Operational Costs

1. **Count your assessments per page, not per form.** If any of the 15 apps load `execute()` on every page view (a common v3 pattern for building a passive risk score) rather than only on the specific action that matters (login, checkout, form submit), your assessment volume — and therefore cost — is dominated by page views, not meaningful actions. Auditing and trimming *where* `execute()` is called is the single highest-leverage cost lever you have.
2. **Don't multiply real actions by number of apps unnecessarily.** If some of the 15 apps are really front-ends to the same underlying user journey (e.g., different regional storefronts), consider whether a shared verification point could reduce total assessment count — though this is an architectural decision with its own trade-offs, not a pure cost optimization.
3. **Watch dev/uat traffic, especially automated E2E/CI runs.** A CI pipeline that runs reCAPTCHA-covered flows on every commit across 15 apps can silently generate meaningful assessment volume against the shared org-wide free allowance — consider stubbing/mocking `grecaptcha.execute()` in automated tests rather than hitting the live API, reserving real calls for a smaller set of scheduled smoke tests.
4. **Set budget alerts before you need them**, per environment project (Section 7), so a traffic spike (legitimate or bot-driven) is caught as a notification, not a surprise line item next month.
5. **Use labels for chargeback, not for cost reduction.** As shown in 10.5, splitting keys or projects does not itself reduce the bill — the bill is driven by total assessments per project. Use labels to *attribute* cost to the right app/team so that whoever is generating the volume feels the incentive to optimize it, rather than assuming project/key topology is a lever on the total.
6. **Re-evaluate the Enterprise (contract) tier only once volume is real and stable**, not speculatively — committing to a 12-month volume-based subscription before you have solid post-migration usage data risks over- or under-committing relative to actual need.
7. **Periodically review which apps still need reCAPTCHA on every flow.** If Account Defender or other passive account-protection signals are adopted later (Section 2.2), some previously-necessary explicit `execute()` calls on certain flows may become redundant, an ongoing cost/complexity review worth revisiting after migration rather than a one-time decision.

### 10.7 Sources

- Billing information (tier costs, free-allowance pooling, examples) — <https://docs.cloud.google.com/recaptcha/docs/billing-information>
- Compare Fraud Defense tiers — <https://docs.cloud.google.com/recaptcha/docs/compare-tiers>
- Pricing overview — <https://cloud.google.com/security/products/recaptcha#pricing>
- Quotas and limits — <https://docs.cloud.google.com/recaptcha/quotas>
- Usage reporting using labels (attribution, not cost reduction) — <https://docs.cloud.google.com/recaptcha/docs/labels>
- Cloud Billing budgets and alerts — <https://docs.cloud.google.com/billing/docs/how-to/budgets>
- Indicative EUR/USD exchange rate reference (verify current rate before budget use) — <https://www.poundsterlinglive.com/history/EUR-USD-2026>

---

## 11. ng-recaptcha-2: Compatibility and Alternatives

### 11.1 Executive Summary

`ng-recaptcha-2` continues to work after migration with **no required changes**, because migrated score-based keys keep serving the same `api.js` loader and `grecaptcha.execute()` contract the library already wraps. It is not, however, actively built around the newer `enterprise.js` loader or Enterprise-specific client-side capabilities. The team does not need to replace it to complete this migration, but should treat it as a maintenance-risk dependency worth monitoring, and has a low-effort path to either keep it, patch around its gaps with a thin custom service, or move to Google's own Angular-agnostic JS API directly if Enterprise-specific frontend features become a priority later.

### 11.2 Detailed Discussion

**What `ng-recaptcha-2` is.** It's a community fork — maintained by a single GitHub contributor (LakhveerChahal) — of the long-standing `ng-recaptcha` project (originally by DethAriel), created specifically to add Angular 18+ compatibility after the original project's maintenance slowed. It wraps Google's classic `api.js` script and exposes `RecaptchaV3Module` / `ReCaptchaV3Service` with an `execute(action): Observable<string>` contract — precisely the API your 15 apps already use.

**Does it still work post-migration?** Yes, functionally, for the score-based key type your apps already use: Google's migration documentation is explicit that existing v3 web-page instrumentation continues to work unchanged against a migrated key, and `ng-recaptcha-2` is just a thin Angular wrapper around that same instrumentation.

**What it does *not* give you.** It does not currently expose:

- The `enterprise.js` loader / `grecaptcha.enterprise.execute()` namespace specifically (some Enterprise-only client behaviors are gated behind this script, though the score-based token flow itself is compatible either way).
- First-class support for the newer **checkbox** or **policy-based challenge** key types (Premium/Enterprise features) — only score-based (v3-style) usage is covered, which matches your stated scope (score-based only) but is worth flagging if any app later wants a visible challenge fallback.
- Any built-in handling of Enterprise-specific reason codes or explicit `siteKey`/`expectedAction` payload shaping — though this is arguably backend-side work anyway (Section 9) and not something a frontend wrapper library needs to own.

**Maintenance risk.** As a single-maintainer fork of an already slow-moving upstream project, `ng-recaptcha-2` carries typical small-open-source-project risk: no guarantee of prompt updates for future Angular major versions, and no visibility into Google-side loader changes being tracked proactively. For a 15-app estate maintained long-term by one team, this is a real (if currently low-urgency) dependency-health consideration independent of the reCAPTCHA migration itself.

**Do-it-yourself alternative.** Because the underlying integration surface is small (load a script, call a global function, wrap the callback in an Observable/Promise), a thin, in-house Angular service wrapping `grecaptcha.enterprise.execute()` directly is a realistic, low-effort alternative if the team wants to shed the third-party dependency and gain direct control over the loader URL:

```ts
// recaptcha.service.ts — illustrative in-house replacement
import { Injectable, NgZone } from '@angular/core';
import { Observable } from 'rxjs';

declare const grecaptcha: any;

@Injectable({ providedIn: 'root' })
export class RecaptchaService {
  constructor(private zone: NgZone) {}

  loadScript(siteKey: string): Promise<void> {
    if ((window as any).grecaptcha) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `<https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`;>
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  execute(siteKey: string, action: string): Observable<string> {
    return new Observable((subscriber) => {
      grecaptcha.enterprise.ready(() => {
        grecaptcha.enterprise
          .execute(siteKey, { action })
          .then((token: string) => this.zone.run(() => {
            subscriber.next(token);
            subscriber.complete();
          }))
          .catch((err: unknown) => this.zone.run(() => subscriber.error(err)));
      });
    });
  }
}
```

This removes the third-party dependency entirely, uses the officially documented `enterprise.js` loader, and is small enough (well under 50 lines) for a 15-app shared library to own and test directly — but it does mean the team now owns loader-script maintenance that `ng-recaptcha-2` currently provides for free.

**Alternative published libraries.** A broader Angular ecosystem search surfaces:

- `ngx-captcha` — actively maintained, broader feature set (v2, v3-beta, invisible), but not purpose-built for Enterprise/reCAPTCHA (Sept 2026) either — same category of wrapper as `ng-recaptcha-2`.
- `ngx-captcha-kit` — newer, explicitly markets Angular 20+/Signals/zoneless compatibility, worth a closer look if any of the 15 apps are moving toward zoneless change detection, though it is a small/young project (less battle-tested than `ng-recaptcha-2`'s upstream lineage).
- None of the actively-published Angular wrapper libraries surveyed are built *specifically* around the post-April-2026 Fraud Defense/Enterprise API from the ground up — this is a young enough platform change that the ecosystem hasn't caught up yet, reinforcing that the thin in-house wrapper above is a reasonable medium-term hedge regardless of which path you pick short-term.

**Google's own reference implementations.** Google does not publish an official Angular library, but does publish official reference JS snippets (used above) and official mobile SDKs (iOS/Android) plus a React Native SDK — useful if the mobile team ever needs equivalent protection, though out of scope for these 15 web apps.

### 11.3 Implementation Steps (Recommendation)

1. **Keep `ng-recaptcha-2` for the migration itself** — it is not a blocker, and replacing it is a separable decision from migrating the keys.
2. **Track it as a dependency-health item**, not a migration blocker: revisit in 6–12 months, or immediately if any app hits an Angular version it doesn't yet support.
3. **If/when the team wants direct control** (Enterprise loader, custom reason-code handling, zoneless readiness), adopt the thin in-house `RecaptchaService` pattern shown above as a shared library used by all 15 apps — this is a bounded, low-risk piece of work independent of the reCAPTCHA (Sept 2026) migration timeline.
4. **Do not adopt `ngx-captcha` or `ngx-captcha-kit` reactively** without evaluating them against the same criteria (maintenance activity, Enterprise-loader support, zoneless readiness) — neither is currently a clear net improvement over either "keep `ng-recaptcha-2`" or "go in-house."

### 11.4 Sources

- ng-recaptcha-2 (GitHub) — <https://github.com/LakhveerChahal/ng-recaptcha-2>
- ng-recaptcha (upstream project) — <https://github.com/DethAriel/ng-recaptcha>
- Install score-based keys on web pages (official loader/script reference) — <https://docs.cloud.google.com/recaptcha/docs/instrument-web-pages>
- Migrate from reCAPTCHA Classic (frontend compatibility guarantee) — <https://docs.cloud.google.com/recaptcha/docs/migrate-recaptcha>
- Choose the reCAPTCHA key type (score vs. checkbox vs. policy-based) — <https://docs.cloud.google.com/recaptcha/docs/choose-key-type>
- ngx-captcha (alternative library) — <https://github.com/Enngage/ngx-captcha>
- ngx-captcha-kit (alternative library, Angular 20+/Signals) — <https://github.com/edward124689/ngx-captcha-kit>
- reCAPTCHA mobile SDKs (iOS/Android reference, for context) — <https://docs.cloud.google.com/recaptcha/docs/setup-overview-mobile>

---

## 12. Assumptions, Caveats, and Self-Assessment

### 12.1 Key Assumptions Made in This Document

1. **"Migrating to reCAPTCHA Enterprise" = migrating to the Premium tier of reCAPTCHA (Sept 2026)** for the primary cost/architecture narrative, with true contract-based Enterprise treated as a secondary, future option — confirmed as the intended framing with you before drafting.
2. **Cost scenarios (10k/20k/50k/100k) are per individual Angular application**, per your explicit confirmation, and are additionally presented on an organization-wide pooled basis because that is how billing actually applies — both views are included so neither number is read in isolation and misapplied to a budget request.
3. **The Node.js backend authentication section assumes a fully on-premises deployment** with no existing Google Cloud workload identity, and recommends Workload Identity Federation as the target state; if any part of the backend already runs on GCP infrastructure (e.g., a hybrid setup), some of this section's effort estimate would be lower.
4. **The 3-project (dev/uat/prod) topology in Section 5 is a recommendation, not a description of an existing decision** — it directly answers your open question about the best cost/usage-monitoring structure, but should be validated against any existing GCP project-naming/governance conventions elsewhere in the company before being finalized.
5. **The EUR figures in Section 10.5 use an indicative exchange rate** or approximately 1 USD ≈ 0.87 EUR as of mid-2026 market data, not a live rate — treat these as directional only and re-check before any formal budget submission.
6. **ng-recaptcha-2 compatibility is assessed based on its public GitHub description and the official Google migration guarantees**, not by directly testing it against a live migrated key — a short technical spike validating this in your pilot migration (Section 4.3, step 5) is recommended before treating it as fully confirmed.

### 12.2 Caveats

- Google's product terminology and tier structure changed materially in April 2026, only months before this document was written; further changes before or during your migration window are plausible, and the team should re-check <https://docs.cloud.google.com/recaptcha/docs/compare-tiers> and <https://docs.cloud.google.com/recaptcha/docs/billing-information> immediately before finalizing an implementation plan.
- This document does not cover mobile application protection (iOS/Android SDKs) or non-score key types (checkbox, policy-based challenge) in depth, since your stated scope is score-based web migration; Section 5.6 of the "other alternatives" note in Section 8 and Section 11 briefly flag these as available but out of scope.
- This is not a legal or compliance document. The GDPR controller/processor shift noted in Section 3.2 should be independently reviewed by your legal/DPO function, not treated as complete guidance here.
- Cost figures are based on published list pricing; no volume discounts, existing Google Cloud committed-use agreements, or company-specific billing arrangements were assumed, since none were provided.

### 12.3 Self-Assessment: Data Gaps and Uncertainties

- **Highest-confidence areas:** the tier/pricing structure (Sections 1, 10) and the IAM role/permission tables (Section 6) are drawn directly from current official Google Cloud documentation and are the most reliable parts of this analysis.
- **Moderate-confidence areas:** the recommended 3-project topology (Section 5) and the labeling/monitoring setup (Section 7) are sound applications of Google's documented capabilities to your stated goals, but they are a *design recommendation*, not something independently verified against your company's specific GCP organizational policies — validate against existing conventions before implementing.
- **Lower-confidence / worth independent verification:**
  - The precise historical free-tier ceiling for "classic reCAPTCHA v3 pre-April-2026" (commonly cited as 1,000,000/month across secondary sources, but not independently re-verified against a primary Google source still hosting the old terms, since that page has since been superseded).
  - Whether reCAPTCHA (Sept 2026) offers any EU-specific regional processing/data-residency endpoint beyond the general Google Cloud Data Processing Addendum and standard Google Cloud infrastructure commitments — no evidence of a dedicated EU-only reCAPTCHA processing region was found; compliance currently appears to rest on the Cloud DPA and Google's controller→processor status change rather than data-residency controls specific to reCAPTCHA. If EU data residency is a hard requirement (rather than a budgeting-currency consideration, per your stated scope), this should be confirmed directly with Google Cloud or your account team before relying on this document.
  - `ng-recaptcha-2`'s exact behavior against a *migrated* Enterprise-tier key was assessed from documentation and the library's own description, not from a live test — treat Section 11's conclusions as "very likely, pending pilot validation."
  - The EUR conversion figures are explicitly approximate and time-sensitive, as noted above.

---

*End of document.*

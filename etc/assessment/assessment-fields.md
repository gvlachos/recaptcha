# Google reCAPTCHA assessment fields

A detailed breakdown of those four fields from the `event` object in the reCAPTCHA Enterprise `projects.assessments.create` request body.

<https://docs.cloud.google.com/recaptcha/docs/create-assessment-website#create-assessment-request>

## Context: what these fields are for

When your frontend calls `grecaptcha.enterprise.execute()`, it returns an opaque, single-use **token**. That token alone tells Google "a browser executed reCAPTCHA on this site key," but it doesn't carry rich signal about *who* is making the request unless you explicitly supply that context. `userAgent`, `userIpAddress`, `ja3` (and its newer sibling `ja4`) are **optional but strongly recommended** fields that let reCAPTCHA's risk engine correlate the token with network/device-level signals it can't otherwise see server-side. Google explicitly recommends passing these additional values when creating assessments because it helps protect your website and mobile applications against advanced attack patterns and human-led abuse.

`expectedAction` is different in kind — it's not a fingerprinting signal, but an anti-tampering / anti-replay check tied to your own application logic.

---

## 1. `userAgent`

**What it is:** The raw `User-Agent` HTTP header string sent by the client's browser (e.g. `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36`).

**Where you get it:** it's included in the HTTP request in the request header — server-side, you read it the same way you'd read any header (e.g. Express: `req.headers['user-agent']`; Python/Flask: `request.headers.get('User-Agent')`).

**Theory / why it matters:**
- reCAPTCHA cross-checks the User-Agent string against the TLS fingerprint (JA3/JA4) and IP-derived signals. A mismatch — e.g. a User-Agent claiming "Chrome on macOS" but a TLS handshake fingerprint that matches a Python `requests` library or a headless automation tool — is a strong bot signal.
- It also helps detect **User-Agent spoofing**, a common evasion technique where bots set a browser-like UA string to blend in, since the string alone is trivially forgeable but is much harder to fake consistently alongside network-layer signals.
- Do **not** let the client submit this value in the assessment call — always read it from the actual inbound request headers on your backend, otherwise an attacker can simply lie about it.

**Reference:** MDN — User-Agent request header: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/User-Agent

---

## 2. `userIpAddress`

**What it is:** The IP address of the end user's device as seen by your backend.

**Where you get it:**
- If your backend receives the request directly (no proxy/load balancer in front), it's the TCP connection's source IP.
- If you use a proxy server, the IP address is available in the X-Forwarded-For request header — because the proxy overwrites the direct source IP with its own.

**Theory / why it matters:**
- IP address feeds into reputation-based risk signals: known hosting/VPN/proxy ranges, Tor exit nodes, previously-flagged abusive ranges, geolocation consistency with account history, and rate/velocity analysis (many tokens from the same IP in a short window).
- **Important pitfall:** `X-Forwarded-For` can contain a *chain* of IPs (`client, proxy1, proxy2`) if requests pass through multiple hops, and it is trivially spoofable by the client unless your edge/load balancer strips and re-adds it. You should extract the correct IP based on your specific infrastructure (e.g., if you're behind Google Cloud Load Balancing, Cloudflare, AWS ALB, etc., each has its own trusted header convention) rather than blindly taking the first value in that header.
- Passing an inaccurate or client-supplied IP undermines this signal entirely — it should always be derived from trusted infrastructure metadata, never from a field the browser fills in.

**Reference:** MDN — X-Forwarded-For header: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For

---

## 3. `ja3` (and `ja4`)

**What it is:** A fingerprint of the **TLS Client Hello** — the very first, unencrypted message a client sends when initiating a TLS handshake, before any application data (including the User-Agent header) is exchanged.

**Theory:**
- During a TLS handshake, the client advertises details like: TLS version, supported cipher suites, extensions, elliptic curves, and elliptic curve point formats, all in a specific order.
- **JA3** takes those fields, concatenates them in a defined order, and MD5-hashes the result to produce a compact fingerprint string (e.g. `769,47-53-5-10-...,0-...,23-24,0`).
- Different TLS *libraries* (OpenSSL, BoringSSL, Python's `ssl`, Go's `crypto/tls`, mobile OS TLS stacks, headless-browser automation stacks like Puppeteer/Playwright) each construct their Client Hello slightly differently — so the JA3 hash acts as a fingerprint of the underlying software/library making the connection, **independent of what the User-Agent header claims**.
- This is powerful because User-Agent is just a string an attacker controls, but reproducing a genuine browser's exact TLS handshake byte-for-byte is much harder for a scripted bot — so a "Chrome" User-Agent paired with a JA3 hash known to belong to `curl` or `python-requests` is a strong automation signal.
- `ja4` is the newer, more robust successor to JA3 (it adds things like ALPN and ordering-independence to resist trivial evasion); Google recommends supplying it alongside or instead of JA3 where possible, though `ja3` is still explicitly supported and documented.

**How you generate it:** You don't get this from a standard HTTP header — you need a component in your infrastructure that inspects the raw TLS handshake (e.g., a TLS-terminating proxy/load balancer, a custom nginx module, or a dedicated fingerprinting library) to compute the hash and forward it to your backend (often as a custom header) before you include it in the assessment call.

**References:**
- JA3 documentation on GitHub (Salesforce): https://github.com/salesforce/ja3
- JA4 documentation on GitHub (FoxIO): https://github.com/FoxIO-LLC/ja4
- Google's [own field guidance](https://docs.cloud.google.com/recaptcha/docs/create-assessment-website#create-assessment-request) for the REST request: `JA3`: JA3 fingerprint for the TLS client — Google recommends using salesforce/ja3 for computing JA3.

---

## 4. `expectedAction`

**What it is:** The string you specify as your own application-defined label for the interaction, matched to the `action` parameter you passed on the *client side* when calling `grecaptcha.enterprise.execute(siteKey, {action: 'login'})`.

**Theory / why it matters — this is an anti-tampering check, not a fingerprinting signal:**
- reCAPTCHA v3/Enterprise score-based keys let you tag *every* protected interaction on your site with a semantic action name — `login`, `signup`, `checkout`, `password_reset`, etc. this is the user-initiated action that you specified for action in the grecaptcha.enterprise.execute() call, such as login.
- When the token comes back from Google, the response includes `tokenProperties.action` — the action name that was *actually* embedded in the token at generation time, cryptographically bound by Google, not something the client can forge after the fact.
- You then compare that returned `action` against the `expectedAction` you expected for this endpoint. Google's own guidance: verify that the return value of action matches expectedAction when calling the projects.assessments.create method. If there is a mismatch, it indicates that an attacker is attempting to falsify actions. When mismatched, you can take actions against the user interaction, such as adding additional verifications or blocking the interaction to prevent any fraudulent activities.
- **Why this attack matters:** without this check, an attacker could harvest a legitimate, high-scoring token generated for a low-stakes action (e.g. viewing a page) and replay it against a sensitive endpoint (e.g. a login or checkout form) before the token expires, essentially laundering a "clean" token onto a risky action. Binding the action name into the token and verifying it server-side closes that hole.
- Caveat: actions are not supported for the checkbox key integrations that render widgets explicitly — this field is relevant for score-based (and Universal) keys, less so for explicitly-rendered checkbox widgets.

**References:**
- Action names guidance: https://docs.cloud.google.com/recaptcha/docs/actions-website
- Interpreting the assessment / score+action logic: https://docs.cloud.google.com/recaptcha/docs/interpret-assessment-website

---

## How to think about these fields

The four fields split into two very different categories of defense:

- **`userAgent` + `ja3`/`ja4`** → device/network fingerprint **consistency checking** (is this really what it claims to be?)
- **`userIpAddress`** → **reputation and velocity** analysis (is this network location/behavior associated with abuse?)
- **`expectedAction`** → **application-layer anti-tampering** (was this specific token generated for this specific sensitive operation, or replayed from somewhere else?)

Below is each field's attack model, concrete scenarios, and further reading.

---

## 1. `userAgent` + `ja3` — TLS/HTTP fingerprint mismatch detection

**The underlying theory:** A TLS handshake happens *before* any HTTP request (and therefore before any JS-controllable header) is sent. The Client Hello — TLS version, cipher suite list/order, extensions, elliptic curves — is a byte-level signature of the *TLS library* actually making the connection, not something the calling code chooses. Different libraries produce different signatures: TLS fingerprinting identifies the software making an HTTPS connection by inspecting the Client Hello packet, which announces the TLS version, cipher suites, extensions, and their order — a byte-level signature of the underlying TLS library. Crucially, you can put any string into the User-Agent field, but you cannot easily change the cipher suite list your TLS library ships with, so a script claiming to be Chrome gets caught the moment the handshake hits the wire.

**Attack scenario A — Scraper/bot impersonating a real browser (OWASP OAT-011 Scraping, OAT-021 Denial of Inventory, OAT-004 Fingerprinting evasion):**
An attacker writes a scraper using Python `requests`, Node `axios`, or a headless browser, and sets `User-Agent: Mozilla/5.0 ... Chrome/128...` to look legitimate. At the HTTP layer alone this is indistinguishable from a real Chrome user. But websites and security systems use JA3 fingerprints to identify and block automated tools, comparing the JA3 hash with the User-Agent string — a mismatch indicates spoofing. Different libraries such as the default Python requests, httpx, aiohttp, Go's net/http, and Node.js axios each use their platform's default TLS stack and produce a distinctive JA3 hash that anti-bot systems recognize instantly. reCAPTCHA can flag this exact class of forgery when both `userAgent` and `ja3`/`ja4` are supplied together.

**Attack scenario B — Headless browser automation (OAT-009 CAPTCHA Defeat attempts, credential stuffing tooling):**
Real browsers like Chrome, Firefox, and Safari produce distinct JA3/JA4 hashes that differ from headless browsers such as Puppeteer/Playwright and automation tools like curl or python-requests, so a system that cross-validates and finds a "Chrome 130" User-Agent paired with a TLS fingerprint matching python-requests treats it as a confirmed bot. This is why bot-mitigation vendors (Cloudflare, Akamai, AWS WAF) all ship JA3/JA4 in their bot-management products: TLS fingerprinting lets security teams track the same bot or malware across thousands of rotating IPs because the underlying TLS library produces the same Client Hello fingerprint every time, and JA3 is now a standard feature in major WAF platforms including Cloudflare, Akamai, and AWS WAF.

**Why this matters more than it might seem:** automated traffic reached 51% of all web traffic in 2024, a first in a decade, and bad bots made up 37% of all traffic — a site that cannot tell a library from a browser is blind to more than a third of its traffic, concentrated at login endpoints, pricing pages, search APIs, and RSS feeds.

**Reading:**
- Google's own field description in the assessment API: https://docs.cloud.google.com/recaptcha/docs/create-assessment-website#create-assessment-request
- JA3 reference implementation (Salesforce): https://github.com/salesforce/ja3
- JA4 reference (FoxIO): https://github.com/FoxIO-LLC/ja4
- Scrapfly — JA3/JA4 TLS Fingerprinting Guide to Detection and Evasion: https://scrapfly.io/blog/posts/ja3-ja4-tls-fingerprinting-guide-to-detection-and-evasion
- "TLS fingerprinting explained" (Centinel Analytica): https://www.centinelanalytica.com/learn/tls-fingerprinting-explained
- TrustMyIP — breakdown of JA3 hash components: https://trustmyip.com/ja3-fingerprint

---

## 2. `userIpAddress` — reputation, velocity, and origin analysis

**The underlying theory:** IP address feeds a completely different signal class than TLS/UA — not "is this a bot's software," but "is this network location/behavior consistent with abuse." It supports reputation lookups (known hosting/VPN/Tor ranges, previously flagged abusive ranges), velocity analysis (many requests/logins in a short window from one address or ASN), and geolocation-consistency checks.

**Attack scenario A — Credential stuffing (OWASP OAT-008):** Credential stuffing is a cyberattack in which credentials obtained from a data breach on one service are used to attempt to log in to another, unrelated service, relying on password reuse. Modern credential-stuffing software circumvents naive IP-banning defenses by using bots to attempt many simultaneous logins that appear to come from different device types and originate from different IP addresses — which is exactly why IP reputation (not just a single IP's history) matters: attacks often originate from data centers, hosting providers, or proxy services rather than residential IPs, with connections coming from VPNs, anonymizers, or previously flagged attack infrastructure.

**Attack scenario B — Login velocity spikes:** Detecting credential stuffing requires monitoring behavioral anomalies, not just failed logins — login velocity is the most obvious signal, since spikes in login attempts from a single IP or ASN are a red flag that legitimate users would never produce, and traffic from datacenter ranges, Tor exit nodes, or flagged VPN providers warrants extra scrutiny. reCAPTCHA's risk engine can factor `userIpAddress` into exactly this kind of velocity/reputation scoring when assessing a login-action token.

**Attack scenario C — Account takeover with geographic inconsistency:** "Impossible travel" — the same account authenticating from, say, London and Tokyo within 30 minutes — is a high-fidelity fraud signal. This class of check is specifically what Google's **Account Defender** add-on for reCAPTCHA Enterprise is built to layer on top of IP + account signals: https://docs.cloud.google.com/recaptcha/docs/account-defender

**Recommended response pattern (industry-standard, not just Google's):** OWASP recommends a graduated response model — introduce delays, then CAPTCHA, then MFA challenges, then temporary blocks — rather than relying on a single hard threshold, which maps directly onto how you'd use a reCAPTCHA score (low score → step-up MFA rather than an outright block, for example).

**Reading:**
- OWASP Credential Stuffing overview: https://owasp.org/www-community/attacks/Credential_stuffing
- OWASP Automated Threats to Web Applications (the canonical taxonomy — OAT-008 Credential Stuffing, OAT-007 Credential Cracking, OAT-011 Scraping, OAT-005 Scalping, etc.): https://owasp.org/www-project-automated-threats-to-web-applications/
- Cloudflare — What is Credential Stuffing: https://www.cloudflare.com/learning/bots/what-is-credential-stuffing/
- MDN — X-Forwarded-For (how you actually extract the IP server-side): https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For
- Google — Account Defender: https://docs.cloud.google.com/recaptcha/docs/account-defender

---

## 3. `expectedAction` — token replay / action-tampering prevention

**The underlying theory:** This is not a network/device fingerprint at all — it's a cryptographic binding check within your own application logic. When you call `grecaptcha.enterprise.execute(siteKey, {action: 'login'})`, Google embeds that action name into the returned token server-side, in a way the client cannot alter afterward. Your backend later compares `tokenProperties.action` (what Google actually recorded) against `expectedAction` (what your endpoint expects for itself).

**Attack scenario — Token laundering / replay across actions:** An attacker's script executes reCAPTCHA against a *cheap, low-risk* action first — e.g. loading a public content page (action `homepage_view`) — which reliably earns a high score because it looks like normal traffic. The attacker then tries to reuse that same token against a *high-value, high-risk* endpoint, such as a login form, checkout, or account-creation call (action `login` or `signup`), hoping the high score carries over. Without verifying `expectedAction`, your backend would accept a "clean" token that was never actually generated for the sensitive action being protected — effectively laundering trust from a benign interaction onto an abusive one. This maps to OWASP's broader **OAT-002 Token Cracking / token-misuse** and **OAT-019 Account Creation / OAT-008 Credential Stuffing** categories, where automated actors specifically target the weakest-verified endpoint of a multi-step flow: OWASP's OATv2 taxonomy documents 21 automated threats carried out using bots, scripts, and headless browsers that target business-logic vulnerabilities and operational gaps rather than classic software vulnerabilities, and action-mismatch abuse against form/token logic is exactly that class of business-logic gap rather than a code-injection bug.

**Reading:**
- Google — Action names for websites (how to name and verify actions): https://docs.cloud.google.com/recaptcha/docs/actions-website
- Google — Interpreting assessments (score + action + reasons together): https://docs.cloud.google.com/recaptcha/docs/interpret-assessment-website
- OWASP Automated Threats to Web Applications (OATv2) — full taxonomy of token/business-logic abuse patterns: https://owasp.org/www-project-automated-threats-to-web-applications/

---

## Summary table

| Field | Attack class it defends against | Mechanism | Key reading |
|---|---|---|---|
| `userAgent` + `ja3`/`ja4` | Bot/scraper impersonation, headless-browser automation, UA spoofing | Cross-checks HTTP-layer claim vs. TLS-layer reality | https://scrapfly.io/blog/posts/ja3-ja4-tls-fingerprinting-guide-to-detection-and-evasion · https://github.com/salesforce/ja3 |
| `userIpAddress` | Credential stuffing, account takeover, proxy/VPN/Tor abuse, login-velocity attacks | IP reputation + velocity + geo-consistency scoring | https://owasp.org/www-community/attacks/Credential_stuffing · https://docs.cloud.google.com/recaptcha/docs/account-defender |
| `expectedAction` | Token replay / action-laundering across endpoints of differing sensitivity | Verifies the token was minted for *this specific* action, server-side | https://docs.cloud.google.com/recaptcha/docs/actions-website |
| (all, combined) | General automated-threat taxonomy these fields feed into | — | https://owasp.org/www-project-automated-threats-to-web-applications/ |


---

## Example request putting it all together

```json
{
  "event": {
    "token": "03AGdBq27...",
    "siteKey": "6Lc...",
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "userIpAddress": "203.0.113.42",
    "ja4": "t13d1516h2_8daaf6152771_02713d6af862",
    "ja3": "769,4865-4866-4867-49195-49199,0-23-65281-10-11-35-16-5-13-18-51-45-43-27,29-23-24,0",
    "expectedAction": "login"
  }
}
```

Server-side pseudocode for the checks that matter most (action + IP/UA extraction):

```python
response = client.create_assessment(request)

if not response.token_properties.valid:
    # token invalid/expired/reused — block or re-challenge
    ...
elif response.token_properties.action != "login":
    # action mismatch — possible token replay/tampering, treat as high risk
    ...
else:
    score = response.risk_analysis.score  # 0.0 (bot) - 1.0 (human)
```

## Other relevant official links
- Create assessments overview (source page): https://docs.cloud.google.com/recaptcha/docs/create-assessment-website
- Interpreting assessments/scores: https://docs.cloud.google.com/recaptcha/docs/interpret-assessment-website
- Action names best practices: https://docs.cloud.google.com/recaptcha/docs/actions-website
- `projects.assessments.create` REST reference: https://docs.cloud.google.com/recaptcha/docs/reference/rest/v1/projects.assessments/create
- reCAPTCHA keys overview: https://docs.cloud.google.com/recaptcha/docs/keys


| # | Link | Description |
|---|---|---|
| 1 | https://docs.cloud.google.com/recaptcha/docs/create-assessment-website | Main page: Create assessments for websites |
| 2 | https://docs.cloud.google.com/recaptcha/docs/create-assessment-website#create-assessment-request | Section: Create assessment request (original anchor) |
| 3 | https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/User-Agent | MDN — User-Agent request header |
| 4 | https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For | MDN — X-Forwarded-For header |
| 5 | https://github.com/salesforce/ja3 | JA3 fingerprinting method (Salesforce, GitHub) |
| 6 | https://github.com/FoxIO-LLC/ja4 | JA4 fingerprinting method (FoxIO, GitHub) |
| 7 | https://docs.cloud.google.com/recaptcha/docs/actions-website | Action names guidance for websites |
| 8 | https://docs.cloud.google.com/recaptcha/docs/interpret-assessment-website | Interpreting assessments for websites (score/reasons) |
| 9 | https://docs.cloud.google.com/recaptcha/docs/reference/rest/v1/projects.assessments/create | REST API reference: `projects.assessments.create` |
| 10 | https://docs.cloud.google.com/recaptcha/docs/keys | reCAPTCHA keys overview |
| 11 | https://docs.cloud.google.com/recaptcha/docs/account-defender | Account Defender (fraud detection on accounts) |


---

## JA3 / JA4

### Important: the repo is now archived

**salesforce/ja3 was archived (read-only) by the owner on May 1, 2025** and is no longer maintained. Salesforce's own README says JA3's original creator, John Althouse, now maintains the current state of TLS client fingerprinting at FoxIO-LLC (the JA4 project). Google's docs still reference salesforce/ja3 as the recommended tool, but going forward JA4 (https://github.com/FoxIO-LLC/ja4) is the actively maintained successor and arguably the better choice for new integrations. That said, here's how salesforce/ja3 actually works.

### What it fundamentally is

It's **not an HTTP/web-server library** — it's a packet-capture tool. It reads raw network traffic (live from a NIC, or from a `.pcap` file) via `tshark`/`pyshark`, extracts the TLS Client Hello, and computes the JA3 hash from it. This matters for your use case: **it doesn't plug directly into an Angular/Node/Express request handler**, because by the time your application code sees an HTTP request, the TLS handshake has already been decrypted and abstracted away by your web server or TLS-terminating proxy. You need something with access to the raw handshake bytes.

### Installation

```bash
# Requires tshark (part of Wireshark) to be installed and on PATH
sudo apt-get install tshark      # Debian/Ubuntu
# or: brew install wireshark     # macOS

pip install pyja3   # or clone the repo and pip install -r requirements.txt
```

The repo's own requirements are `pyshark` (Python wrapper around `tshark`) plus standard packet-parsing libs.

### Usage — from a pcap file (offline analysis)

```bash
ja3 /path/to/capture.pcap
```

This prints JSON records like:

```json
{"source": "10.0.0.5", "destination": "93.184.216.34", "destination_port": 443,
 "ja3": "769,47-53-5-10-49161-...,0-10-11,23-24,0",
 "ja3_digest": "e7d705a3286e19ea42f587b344ee6865"}
```

`ja3_digest` is the actual MD5 hash you'd want to pass as the `ja3` field to reCAPTCHA. As reference points: the JA3 fingerprint for the standard Tor client is a known constant value (`e7d705a3286e19ea42f587b344ee6865`), and known malware families like Trickbot and Emotet also produce their own constant, recognizable JA3 hashes — the whole point being that while destination IPs, ports, and certificates vary, the JA3 fingerprint stays consistent for a given client application.

### Usage — live capture on an interface

```bash
ja3 -i eth0
```

This sniffs live traffic on that interface and emits JA3 records as new TLS handshakes occur — this is the mode that's theoretically relevant to a running server, but it requires the process to have raw packet capture access (root/`CAP_NET_RAW`) on the box actually terminating TLS.

### Python API (if you want to call it from code rather than shell out)

```python
from ja3 import ja3

# process a saved pcap
records = ja3.process_pcap('/path/to/capture.pcap')
for r in records:
    print(r['ja3_digest'])
```

(Exact function names vary slightly by fork/version — check the repo's `ja3/ja3.py` source directly since documentation is sparse and it's unmaintained now.)

### Why this is awkward for a typical web backend — and what people actually do instead

Because it needs raw packet access, teams almost never invoke salesforce/ja3 synchronously inside a request handler. In practice there are two real patterns:

1. **Let your edge/proxy compute it and inject it as a header.** Most production setups get JA3 not by running this tool themselves, but from infrastructure that already sees the raw handshake — Cloudflare, AWS WAF/CloudFront, Akamai, or an nginx module, all of which have JA3 support built in, since JA3 is now a standard feature in major WAF platforms. Your application then just reads that injected header (e.g. `X-JA3-Fingerprint`) the same way it reads `User-Agent`, and forwards it in the `ja3` field to reCAPTCHA.
2. **Run a sidecar packet-capture process** (using this tool, or `zeek`/`Suricata`'s built-in JA3 support, both of which are also listed as having native JA3 support) on the same host as your TLS terminator, correlating captured JA3 hashes to specific connections/requests by source IP+port+timestamp, then feeding that into your app's session context.

Directly shelling out to `salesforce/ja3` per-request is generally impractical — it's built for offline forensic/threat-intel analysis of pcaps, not a low-latency per-request lookup.

### Reading

- Repo (archived): https://github.com/salesforce/ja3
- Original announcement — "Open Sourcing JA3": https://engineering.salesforce.com/open-sourcing-ja3-92c9e53c3c41
- Deep-dive blog — "TLS Fingerprinting with JA3 and JA3S": https://engineering.salesforce.com/tls-fingerprinting-with-ja3-and-ja3s-247362855967
- Actively maintained successor, JA4 (FoxIO): https://github.com/FoxIO-LLC/ja4
- Go implementation (if your infra is Go-based, easier to embed than the Python pcap tool): https://pkg.go.dev/github.com/jbremer/ja3

---

## Part 1 — Questions to ask before choosing an implementation

Group these by who in the org needs to answer them.

### A. Architecture / where TLS is actually terminated
- Where does TLS termination happen today — CDN/WAF (Cloudflare, Akamai, Fastly), cloud load balancer (AWS ALB/NLB, GCP Load Balancer, Azure App Gateway), a self-managed reverse proxy (nginx/Envoy/HAProxy), or directly on application servers?
- Is there a **single choke point** all traffic passes through, or multiple ingress paths (direct-to-origin, partner APIs, mobile app backends, internal service mesh) that would each need their own fingerprinting?
- Do we terminate TLS 1.3 with 0-RTT/session resumption anywhere? (Affects what's visible in a given handshake and whether JA4 needs to handle resumed sessions differently from full handshakes.)
- Is QUIC/HTTP-3 in use or planned? (JA4 has QUIC support; JA3 does not — relevant if you're modernizing anyway.)

### B. Licensing and legal (this is the one people skip and regret)
- Will JA4 be used purely **internally** to protect our own applications, or would it ever be **resold, offered as a feature, or embedded in a product we sell**? JA4 (TLS client fingerprint) itself is open-source under BSD-3-Clause with no patent claims, so it's freely usable, but the rest of the suite — JA4S, JA4H, JA4L, JA4X, JA4SSH, JA4T, etc. — is under the FoxIO License 1.1, which is permissive for internal business and security research use but explicitly **not permissive for monetization**; a vendor wanting to sell JA4+ fingerprinting as part of a product needs an OEM license from FoxIO.
- Does legal/procurement need to review the FoxIO License 1.1 text before rollout, given it differs from the plain BSD terms most of the org is used to?
- If we only need the TLS client fingerprint (equivalent to what JA3 did), can we stay entirely on the BSD-3-Clause JA4 component and avoid FoxIO-License-encumbered modules altogether?

### C. Security/detection goals — what exactly are we trying to catch?
- Is the primary goal bot/scraper detection, credential-stuffing detection, malware C2 detection, DDoS/volumetric attack detection, or general fraud/risk scoring feeding something like reCAPTCHA Enterprise?
- Do we need just `ja4` (TLS client), or also `ja4h` (HTTP header fingerprint), `ja4t`/`ja4ts` (TCP fingerprint), `ja4x` (X.509 cert fingerprint), or `ja4ssh` (SSH)? Each has different capture requirements and license terms.
- What's the tolerance for false positives? (Chrome's 2023 extension-shuffling change was specifically designed to defeat fixed fingerprints like JA3, which is part of why JA4 exists — Google implemented a change in Chromium-based browsers to shuffle the order of TLS extensions, and FoxIO built JA4 partly in response to keep fingerprinting resilient to that.)
- Do we need real-time, per-request blocking decisions, or is near-real-time (streamed to a SIEM within seconds) acceptable?

### D. Downstream consumption
- Where does the fingerprint need to end up — a WAF rule engine, a reCAPTCHA Enterprise assessment call, a SIEM (Splunk, Elastic, Datadog), a custom risk-scoring service?
- Does it need to be correlated with other identifiers per-request (session ID, IP, User-Agent) and if so, what's the correlation key and acceptable latency between capture and consumption?
- Is there an existing SIEM/threat-intel pipeline that already ingests JA3 today that this needs to interoperate with or replace?

### E. Data, privacy, and compliance
- Does legal/privacy consider a TLS/device fingerprint personal data under GDPR/CCPA given it can contribute to device tracking? Does it need a DPIA or update to the privacy policy?
- What's the retention period for stored fingerprints, and does it align with existing log-retention policy?
- Are there regions/business units with stricter rules on network-traffic inspection (e.g., works councils, EU data residency) that constrain where the capture/processing can happen?

### F. Operations and scale
- What's peak request volume/TPS at the termination point, and what's the acceptable added latency/CPU overhead for fingerprint computation?
- Who owns lifecycle/patching for a new nginx module or sidecar (platform/infra team vs. security team)?
- Is there budget/appetite for a **paid CDN/WAF feature** (many already ship JA4 as part of bot management) vs. building/operating open-source components in-house?
- Do we already have a JA3-based pipeline in production? If so, does this need to run **in parallel** during a transition period, or can it fully replace JA3 (FoxIO explicitly designed JA4 so any company currently using JA3 can upgrade immediately, since JA4 keeps the same BSD-3-Clause terms)?

---

## Part 2 — Candidate implementation plans

### Option A — Use a CDN/WAF that already computes JA4 natively
**How it works:** Route traffic through a provider that computes JA4 at their edge and injects it as a request header or exposes it via API/logs. Cloudflare is a prominent example — since 2023–2024 they've built JA4 fingerprinting and "inter-request signals" directly into their Bot Management/WAF stack, developed partly in response to Chrome disrupting the JA3-based fingerprinting approach.

**Pros:** Near-zero engineering effort; vendor handles TLS 1.3/QUIC/session-resumption edge cases; scales automatically; usually bundled with broader bot-management tooling (rate limiting, challenge pages) you'd otherwise have to build.

**Cons:** Vendor lock-in; recurring cost; you're dependent on their header/API naming and update cadence; less control over exactly which JA4+ variants are exposed; if you're not already on that CDN, migrating is a much bigger project than "just fingerprinting."

**Best fit:** Orgs already using Cloudflare/Akamai/Fastly-class edge, where enabling an existing feature is cheaper than building.

---

### Option B — Self-hosted nginx module at your own TLS-terminating layer
**How it works:** Deploy FoxIO's `ja4-nginx-module` (a small core patch + module) at whichever nginx instances actually terminate TLS, and have it inject the fingerprint as a custom request header (e.g. `X-JA4`) that your application (or a downstream proxy) reads and forwards.

**Pros:** Full control, no per-request vendor cost, works even if you're not on a JA4-native CDN; the module ships with Docker images/compose files for fast evaluation.
**Cons:** Requires patching/rebuilding nginx core (operational burden — patch management on every nginx upgrade); you own scaling/HA of this component; requires the FoxIO License 1.1 review from Part 1B before production use if you plan to expose more than plain BSD-licensed JA4.

**Best fit:** Orgs already self-hosting nginx as an ingress/reverse-proxy layer with in-house platform engineering capacity.

---

### Option C — Sidecar/out-of-band packet capture (eBPF, Zeek/Suricata, or a Go/Rust library)
**How it works:** Run a capture agent (eBPF-based, or Zeek/Suricata which both have native JA3/JA4 support) alongside your TLS terminator, or embed a library like the `ja4plus` Python implementation or a Go/Rust JA4 library directly into your proxy/load-balancer's request pipeline, correlating captured fingerprints to specific connections by 5-tuple (src IP/port, dst IP/port, timestamp).

**Pros:** Works even where you can't modify the terminator itself (e.g. managed cloud load balancers where you can't install a module); reuses existing network-security tooling (Zeek/Suricata) many enterprises already run for IDS/threat-hunting; can capture the *whole* JA4+ family (JA4T, JA4H, JA4X) in one pipeline for broader threat-hunting use cases beyond just bot detection.
**Cons:** Highest engineering complexity of the three options — correlation logic, packet-capture permissions (root/CAP_NET_RAW or eBPF privileges), and latency between capture and consumption all need careful design; doesn't naturally give you a synchronous per-request value at the moment your app needs to make a decision (e.g., before calling reCAPTCHA), so it suits async/SIEM-style detection better than real-time blocking.

**Best fit:** Security/threat-hunting teams building a broader detection platform (not just a single "inject a header" use case), or environments using managed load balancers where you can't install custom modules.

---

### Option D — Managed load balancer / service mesh extension
**How it works:** If you're on AWS/Azure/GCP and using their native load balancers, check whether their WAF product has JA4 support (AWS WAF and Azure Firewall are both listed among products with JA3 support historically, and are extending toward JA4 as the successor becomes standard) rather than trying to self-host at that layer, since you often can't install custom modules on managed LBs at all.
**Pros:** Fits cleanly if you're already all-in on one cloud's networking stack; avoids operating your own proxy fleet.
**Cons:** Feature availability and JA4 (vs. only JA3) support varies by provider and region — needs direct verification with the cloud vendor's current docs before committing, since this changes over time.

---

## Suggested phased rollout (regardless of which option is chosen)

1. **POC (2–4 weeks):** Stand up the chosen capture method against a *non-production* endpoint or a mirrored traffic feed; validate you're getting stable JA4 hashes for known clients (real browsers, your mobile app, known bots) and that hashes match FoxIO's published spec/test vectors.
2. **Shadow mode in production (2–4 weeks):** Deploy at the real termination point but only log/forward the fingerprint — don't act on it yet. Correlate against existing signals (User-Agent, IP reputation, existing JA3 data if any) to sanity-check for unexpected mismatch rates.
3. **Soft enforcement (2–4 weeks):** Feed JA4 into risk-scoring/reCAPTCHA assessment calls or WAF rules in "flag, don't block" mode; monitor false-positive rate on known-good traffic (internal QA bots, monitoring probes, legitimate automation/partners you know use non-browser TLS stacks).
4. **Full enforcement:** Move to active blocking/challenging based on JA4 signal, with an exception/allowlist process for legitimate automated clients (internal tools, approved partner integrations) that will otherwise get flagged.
5. **Ongoing:** Track Chrome/Firefox/Safari version rollouts for TLS-stack changes that could shift fingerprint distributions (this happened before with the 2023 extension-shuffling change), and keep an allowlist/exception process live so legitimate new client versions don't get mass-blocked.

---

## Links

| Resource | URL |
|---|---|
| JA4+ main repo (spec, TLS client fingerprint, BSD-3-Clause) | https://github.com/FoxIO-LLC/ja4 |
| JA4+ License FAQ (BSD vs. FoxIO License 1.1, OEM/monetization rules) | https://github.com/FoxIO-LLC/ja4/blob/main/License%20FAQ.md |
| JA4 nginx module (self-hosted implementation option) | https://github.com/FoxIO-LLC/ja4-nginx-module |
| Cloudflare — JA4 fingerprints and inter-request signals (CDN-native option, Option A) | https://blog.cloudflare.com/ja4-signals/ |
| ja4plus — independent Python implementation of full JA4+ suite | https://pypi.org/project/ja4plus/ |
| f5devcentral JA4 module (F5 BIG-IP integration example) | https://github.com/f5devcentral/f5-ja4 |
| Google reCAPTCHA — where the resulting `ja3`/`ja4` value gets consumed | https://docs.cloud.google.com/recaptcha/docs/create-assessment-website#create-assessment-request |

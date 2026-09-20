# IBM Api Connect and Google reCAPTCHA assessments

Google reCAPTCHA assessment fields:

```json
{
  "event": {
    "token": "TOKEN",
    "siteKey": "KEY_ID",
    "userAgent": "USER_AGENT",
    "userIpAddress": "USER_IP_ADDRESS",
    "expectedAction": "USER_ACTION"
  }
}
```

Only `token` and `siteKey` are strictly needed. Google recommends the others to improve detection.

| Field | Where to get it in APIC |
|---|---|
| `token` | Comes from the browser. Your frontend gets it from `grecaptcha.enterprise.execute()` and must send it to your endpoint, for example in the JSON body or an `X-Recaptcha-Token` header. Each token is single-use and expires after 2 minutes. |
| `siteKey` | Your reCAPTCHA key ID. Store it as an API or catalog property, e.g. `$(recaptcha-site-key)`. It isn't secret, but keep it out of the code. |
| `expectedAction` | The action name your frontend passed to `execute()`, e.g. `login`. Hardcode it per operation on the server. Don't trust a value sent by the browser, since the point is to detect forged actions. |
| `userAgent` | The incoming `User-Agent` header: `$(request.headers.user-agent)`, or `headerMetadata.current.get('User-Agent')` in GatewayScript. |
| `userIpAddress` | The end user's IP, not the gateway's. Google says to use `X-Forwarded-For` behind a proxy: `$(request.headers.x-forwarded-for)`. That header can hold a comma-separated list, so take the first entry. Depending on your APIC version and load balancer setup, a client-IP header such as `x-client-ip` may also be available; check what actually arrives. |
| `ja3` / `ja4` | Optional TLS fingerprints. These are computed where TLS terminates, so they're usually not available inside APIC. You can skip them. |
| Project ID and API key | Not part of the event body. The project ID goes in the URL path, and the API key goes in the query string (`?key=`). Store both as properties, with the key as a secret or encrypted. |

The API-key request in Google's doc uses `POST https://recaptchaenterprise.googleapis.com/v1/projects/PROJECT_ID/assessments?key=API_KEY`.

**Assembling it in the assembly**

Add a GatewayScript policy before an `invoke` policy:

```javascript
var hm = require('header-metadata');

// The original request body is the JSON your browser app sent
var incoming = context.get('request.body');   // adjust to how you read your body
var token = incoming.recaptchaToken;          // or read it from a header instead

var xff = hm.current.get('X-Forwarded-For') || '';
var clientIp = xff.split(',')[0].trim();

context.set('recaptcha.payload', {
  event: {
    token: token,
    siteKey: context.get('api.properties.recaptcha-site-key'),
    expectedAction: 'login',
    userAgent: hm.current.get('User-Agent'),
    userIpAddress: clientIp
  }
});
```

Then use an `invoke` policy with:

- **URL:** `https://recaptchaenterprise.googleapis.com/v1/projects/$(project-id)/assessments?key=$(recaptcha-api-key)`
- **Verb:** POST
- **Content-Type:** `application/json`
- **Request body:** the `recaptcha.payload` object, written to `message.body` if your invoke policy uses that
- **Response object variable:** something like `assessment`, so the original request isn't overwritten

If you write the payload into `message.body`, save the original body to a variable first.

**Checking the response**

Add a second GatewayScript after the invoke, and reject the request if any of these fail:

- `tokenProperties.valid` is `true`.
- `tokenProperties.action` equals your `expectedAction`.
- `riskAnalysis.score` is above your threshold (1.0 is likely legitimate, 0.0 is likely a bot).

Google also suggests a non-strict JSON parse of the response, so new fields don't break you.

**Two cautions**
- Keep the API key on the gateway only, and restrict it in Google Cloud (by API and, if possible, by IP).
- The API key in the query string may show up in gateway logs and analytics. Mask it, or use a service account or Workload Identity Federation if your setup allows.

## Implementation

The assembly runs in five steps:

1. `set-variable` copies your properties (site key, min score) into context variables and sets `recaptcha.expectedAction` for the operation.
2. `recaptcha-build-request.js` builds the `event` body from the token, site key, expected action, user agent and client IP. It writes it into a separate message, `recaptcha-request`, so the client's original body is untouched.
3. `invoke` posts that message to Google's assessments endpoint and stores the reply in `recaptcha-response`.
4. `recaptcha-check-assessment.js` fails closed and rejects the request if any of these checks fail:
   - Google returns an HTTP status other than 200 (rejected with a 503).
   - `tokenProperties.valid` is not `true`.
   - The returned `action` differs from your expected one.
   - The score is below your threshold.
5. The backend `invoke` is reached only if all checks pass. It strips the `X-Recaptcha-Token` header before forwarding.

To adapt it, set the property values and change the `login` action. For several operations, wrap steps 1 to 5 in an `operation-switch` with a different `expectedAction` per case. The frontend should send the token in an `X-Recaptcha-Token` header, or in a JSON body field named `recaptchaToken`.

These are the parts to test first, since they depend on your API Connect version and gateway:

- **Client IP:** the script reads `X-Forwarded-For`, then `x-client-ip`. Check which one actually reaches the gateway in your setup, especially if a load balancer sits in front.
- **Request body access:** the token fallback uses `context.get('request.body')`. If it returns nothing on your version, use the header instead.
- **`input`/`output` on `invoke`:** the `2.1.0` invoke policy supports these. If your version doesn't, tell me which one and I'll rework it.
- **Error responses:** `context.reject` plus a status code works, but if you already have `catch` blocks, route `ForbiddenError`, `BadRequestError` and `ServiceUnavailableError` there to shape the JSON your browser app receives.
- **API key:** it ends up in the outbound URL, so mask it in gateway logs and restrict it to the reCAPTCHA Enterprise API in Google Cloud.

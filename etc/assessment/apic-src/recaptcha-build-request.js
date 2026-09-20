// GatewayScript (DataPower API Gateway) - build the reCAPTCHA Enterprise
// projects.assessments.create request body.
//
// Expects these context variables (set by the set-variable policy before this one):
//   recaptcha.siteKey         - your reCAPTCHA key ID
//   recaptcha.expectedAction  - action name for THIS operation (e.g. "login")
//
// Produces a named message "recaptcha-request" that the invoke policy sends.
// The original client request (message) is left untouched.

var siteKey = context.get('recaptcha.siteKey');
var expectedAction = context.get('recaptcha.expectedAction');

// 1. Token: prefer a header, fall back to a JSON body field.
var token = context.get('request.headers.x-recaptcha-token');
if (!token) {
  var reqBody = context.get('request.body');
  if (reqBody && typeof reqBody === 'object') {
    token = reqBody.recaptchaToken;
  }
}

if (!token) {
  context.message.statusCode = '400 Bad Request';
  context.reject('BadRequestError', 'Missing reCAPTCHA token');
} else {
  // 2. End-user IP: X-Forwarded-For may be a comma-separated list; the first
  //    entry is the original client. Falls back to x-client-ip if present.
  var fwd = context.get('request.headers.x-forwarded-for') ||
            context.get('request.headers.x-client-ip') || '';
  var userIp = String(fwd).split(',')[0].trim();

  // 3. User agent of the browser (not the gateway).
  var userAgent = context.get('request.headers.user-agent') || '';

  // 4. Assemble the event. Optional fields are omitted when empty.
  var event = {
    token: String(token),
    siteKey: siteKey,
    expectedAction: expectedAction
  };
  if (userIp) { event.userIpAddress = userIp; }
  if (userAgent) { event.userAgent = String(userAgent); }

  // 5. Create a separate message so the client's original body is preserved
  //    for the backend call later in the assembly.
  var msg = context.createMessage('recaptcha-request');
  msg.header.set('Content-Type', 'application/json');
  msg.body.write({ event: event });
}

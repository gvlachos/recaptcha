// GatewayScript (DataPower API Gateway) - validate the reCAPTCHA assessment.
//
// Expects:
//   recaptcha-response        - output message of the invoke policy
//   recaptcha.expectedAction  - action name for THIS operation
//   recaptcha.minScore        - minimum acceptable score, e.g. "0.5"
//
// Fails closed: any problem rejects the request instead of letting it through.
// Sets recaptcha.score for later policies (logging, risk-based decisions).

function deny(status, name, message) {
  context.message.statusCode = status;
  context.reject(name, message);
}

var httpStatus = context.get('recaptcha-response.status.code');
var assessment = context.get('recaptcha-response.body');

// The body may arrive already parsed or as a string.
if (typeof assessment === 'string') {
  try { assessment = JSON.parse(assessment); } catch (e) { assessment = null; }
}

var expectedAction = context.get('recaptcha.expectedAction');
var minScore = parseFloat(context.get('recaptcha.minScore'));
if (isNaN(minScore)) { minScore = 0.5; }

if (httpStatus !== 200 || !assessment) {
  // Google unreachable, bad API key, quota, malformed request, etc.
  // Don't log the request body or API key here.
  deny('503 Service Unavailable', 'ServiceUnavailableError',
       'reCAPTCHA verification unavailable');

} else if (!assessment.tokenProperties || assessment.tokenProperties.valid !== true) {
  // invalidReason examples: EXPIRED, DUPLICATE, MALFORMED, MISSING, BROWSER_ERROR
  var reason = (assessment.tokenProperties && assessment.tokenProperties.invalidReason) || 'UNKNOWN';
  context.set('recaptcha.invalidReason', reason);
  deny('403 Forbidden', 'ForbiddenError', 'Invalid reCAPTCHA token');

} else if (assessment.tokenProperties.action !== expectedAction) {
  // Action mismatch: token was generated for a different action (possible forgery/replay).
  deny('403 Forbidden', 'ForbiddenError', 'reCAPTCHA action mismatch');

} else {
  var score = assessment.riskAnalysis && assessment.riskAnalysis.score;
  context.set('recaptcha.score', score);
  context.set('recaptcha.reasons', (assessment.riskAnalysis && assessment.riskAnalysis.reasons) || []);

  if (typeof score !== 'number' || score < minScore) {
    deny('403 Forbidden', 'ForbiddenError', 'reCAPTCHA score too low');
  }
  // else: fall through and let the assembly continue to the backend.
}

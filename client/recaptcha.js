/**
 * recaptcha.js
 * ---------------------------------------------------------------
 * Loads Google's reCAPTCHA script and exposes a single
 * `executeRecaptcha(action)` function that resolves with a token,
 * mirroring what `ReCaptchaV3Service.execute()` does in the
 * Angular `ng-recaptcha-2` integration, for teams/pages that are
 * not using Angular.
 *
 * *** WHY THE SCRIPT IS LOADED FROM A JS FUNCTION, NOT <head> ***
 * A classic v3 integration typically hardcodes something like this
 * directly in the HTML <head>:
 *
 *   <script src="https://www.google.com/recaptcha/api.js?render=SITE_KEY"></script>
 *
 * This project deliberately does NOT do that. Instead, the script
 * is injected dynamically by the `loadRecaptchaScript()` function
 * below, called explicitly from application code (see app.js).
 * Reasons this matters in practice, not just style preference:
 *
 *   1. Per-environment site keys (Section 5 of the migration guide:
 *      dev/uat/prod each have a DIFFERENT site key). A static
 *      <head> tag would need the key baked into the HTML at build
 *      time per environment. Loading via a function lets the same
 *      HTML be served everywhere, with the correct key read from
 *      config.js (which your build pipeline already
 *      templates/injects per environment) at *runtime*.
 *   2. The script is only fetched on pages/flows that actually
 *      need reCAPTCHA, rather than on every page load — relevant
 *      to the cost-optimization guidance in the migration guide,
 *      Section 10.6 ("count your assessments per page, not per
 *      form"): a stray <head> tag makes it easy to forget the
 *      script is loading (and, if `action` were fired
 *      indiscriminately, billing) on pages that don't need it.
 *   3. It avoids the loader script blocking/competing with other
 *      <head> resources during initial page render, and gives this
 *      module a single place to add retry/timeout/error handling
 *      that a bare <script> tag cannot provide.
 *   4. It gives one place (this file) to switch the loader URL
 *      between `enterprise.js` and `api.js` (see config.js
 *      `loaderScript`), instead of hunting through HTML templates.
 * ---------------------------------------------------------------
 */

(function () {
  'use strict';

  const config = window.RECAPTCHA_CONFIG;
  if (!config) {
    throw new Error(
      '[recaptcha.js] window.RECAPTCHA_CONFIG is not defined. ' +
        'Make sure config.js is loaded BEFORE recaptcha.js — see index.html.'
    );
  }

  function log(...args) {
    if (config.debug) {
      // eslint-disable-next-line no-console
      console.log('[recaptcha]', ...args);
    }
  }

  // Tracks the in-flight/completed script-loading promise so that
  // calling loadRecaptchaScript() multiple times (e.g. from
  // several independent forms on the same page) only ever injects
  // the <script> tag once and everyone awaits the same load.
  let scriptLoadPromise = null;

  /**
   * Dynamically injects Google's reCAPTCHA loader script into the
   * page and resolves once it has finished loading.
   *
   * Safe to call multiple times — subsequent calls return the same
   * in-flight/settled promise rather than injecting duplicate
   * <script> tags.
   *
   * @returns {Promise<void>}
   */
  function loadRecaptchaScript() {
    if (scriptLoadPromise) {
      log('Script already loading/loaded — reusing existing promise.');
      return scriptLoadPromise;
    }

    scriptLoadPromise = new Promise((resolve, reject) => {
      // Guard against a page that, for some other reason, already
      // has grecaptcha available (e.g. a second copy of this
      // module loaded accidentally) — avoid injecting a duplicate
      // script in that case too.
      if (window.grecaptcha) {
        log('window.grecaptcha already present — skipping script injection.');
        resolve();
        return;
      }

      if (!config.siteKey || config.siteKey.startsWith('__')) {
        // Catches the common mistake of forgetting to replace the
        // "__RECAPTCHA_SITE_KEY__" placeholder from config.js via
        // the build pipeline — fails loudly and immediately rather
        // than silently sending a bad request to Google.
        reject(
          new Error(
            '[recaptcha.js] config.siteKey is missing or still set to its placeholder ' +
              'value. Check that your build pipeline is injecting a real site key into ' +
              'js/config.js for this environment (see the comments in that file).'
          )
        );
        return;
      }

      // config.loaderScript switches between the current
      // 'enterprise.js' loader (default, used by migrated keys)
      // and the legacy 'api.js' loader (only needed if this
      // frontend is still pointed at an un-migrated classic v3
      // key) — see config.js for the full explanation.
      const loaderFile = config.loaderScript === 'api.js' ? 'api.js' : 'enterprise.js';
      const scriptUrl = `https://www.google.com/recaptcha/${loaderFile}?render=${encodeURIComponent(
        config.siteKey
      )}`;

      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.defer = true;

      // A load timeout, since a plain <script> tag never rejects
      // on its own if the network stalls indefinitely (it just
      // never fires `onload`) — without this, a network problem
      // would leave every caller of executeRecaptcha() hanging
      // forever instead of failing in a way the UI can react to.
      const timeoutId = window.setTimeout(() => {
        reject(
          new Error(
            `[recaptcha.js] Timed out after ${config.scriptLoadTimeoutMs}ms waiting for the ` +
              'reCAPTCHA script to load. Check network connectivity and that ' +
              'https://www.google.com is reachable from this browser/network.'
          )
        );
      }, config.scriptLoadTimeoutMs);

      script.onload = () => {
        window.clearTimeout(timeoutId);
        log(`Loaded ${scriptUrl}`);
        resolve();
      };

      script.onerror = () => {
        window.clearTimeout(timeoutId);
        reject(
          new Error(
            `[recaptcha.js] Failed to load the reCAPTCHA script from ${scriptUrl}. ` +
              'Check network connectivity, any Content-Security-Policy restrictions ' +
              '(script-src / connect-src must allow https://www.google.com and ' +
              'https://www.gstatic.com), and that the site key is valid for this domain.'
          )
        );
      };

      document.head.appendChild(script);
      log(`Injecting script tag: ${scriptUrl}`);
    });

    return scriptLoadPromise;
  }

  /**
   * Runs a reCAPTCHA assessment for the given action and resolves
   * with the resulting token, ready to send to your backend's
   * verification endpoint (see app.js for a full example,
   * and the companion recaptcha-backend project for the endpoint
   * that consumes this token).
   *
   * Automatically loads the Google script first if it has not been
   * loaded yet — you do not need to call loadRecaptchaScript()
   * yourself before this, though you may want to (see app.js) to
   * "warm up" the script ahead of time, e.g. as soon as a form
   * comes into view, so the eventual submit click does not have to
   * wait for the network fetch.
   *
   * @param {string} action
   *   A short, stable name describing what the user is doing (e.g.
   *   "login", "checkout_submit", "contact_form"). This MUST match,
   *   exactly, the `expectedAction` your backend route passes into
   *   `verifyRecaptchaToken()` (see
   *   recaptcha-backend/src/routes/verify.js) — a mismatch causes
   *   the backend to reject the token as a possible replay. Use a
   *   distinct action name per user flow rather than one generic
   *   value for the whole app; see:
   *   https://docs.cloud.google.com/recaptcha/docs/actions-website
   *
   * @returns {Promise<string>} Resolves with the reCAPTCHA token.
   */
  async function executeRecaptcha(action) {
    if (!action || typeof action !== 'string') {
      throw new TypeError('executeRecaptcha(action) requires a non-empty action string.');
    }

    await loadRecaptchaScript();

    const engine = config.loaderScript === 'api.js' ? window.grecaptcha : window.grecaptcha.enterprise;

    if (!engine) {
      throw new Error(
        '[recaptcha.js] The reCAPTCHA script loaded, but the expected global ' +
          `(${config.loaderScript === 'api.js' ? 'window.grecaptcha' : 'window.grecaptcha.enterprise'}) ` +
          'was not found. This usually means config.loaderScript does not match the ' +
          'type of key configured — double-check js/config.js.'
      );
    }

    return new Promise((resolve, reject) => {
      // `.ready()` waits until the script has fully initialized
      // (it may still be doing internal setup work briefly after
      // `onload` fires) before it's safe to call `.execute()`.
      engine.ready(() => {
        const startedAt = window.performance ? window.performance.now() : Date.now();

        engine
          .execute(config.siteKey, { action })
          .then((token) => {
            if (config.debug) {
              const elapsed = (window.performance ? window.performance.now() : Date.now()) - startedAt;
              log(`execute("${action}") resolved in ${elapsed.toFixed(0)}ms`);
            }
            resolve(token);
          })
          .catch((err) => {
            reject(
              new Error(
                `[recaptcha.js] grecaptcha execute("${action}") failed: ${err && err.message ? err.message : err}`
              )
            );
          });
      });
    });
  }

  // Exposed as globals for this reference project's plain-<script>
  // setup (see index.html). If your app uses ES modules / a
  // bundler, convert this file to
  // `export { loadRecaptchaScript, executeRecaptcha };` instead —
  // everything above this line is unchanged either way.
  window.RecaptchaClient = {
    loadRecaptchaScript,
    executeRecaptcha,
  };
})();

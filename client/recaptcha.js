/**
 * recaptcha.js
 * ---------------------------------------------------------------
 * Loads Google's reCAPTCHA script and exposes a small API for
 * generating tokens, mirroring what `ReCaptchaV3Service.execute()`
 * does in the Angular `ng-recaptcha-2` integration, for teams/pages
 * that are not using Angular.
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
 *
 * *** MULTIPLE SITE KEYS ON ONE PAGE ***
 * A normal production frontend only ever uses ONE site key (its own
 * environment-specific key from config.js). However, this reference
 * project's `app.js` demo additionally simulates several DIFFERENT
 * frontend applications sharing one backend, each with its own site
 * key — this is what actually exercises the backend's per-app
 * site-key validation (see recaptcha-backend's
 * `SITE_KEY_MISMATCH` check).
 *
 * Google supports this: you can load more than one site key on the
 * same page by injecting one <script src="...?render=KEY"> tag per
 * key. Each script registers its key with the shared
 * `grecaptcha.enterprise` global; after each has loaded, you call
 * `execute(thatKey, { action })` for whichever key you need. Every
 * function below therefore accepts an OPTIONAL `siteKey` parameter
 * that defaults to `config.siteKey` — a normal single-key frontend
 * never needs to pass it and can ignore this entirely.
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

  // Tracks one in-flight/completed script-loading promise PER SITE
  // KEY, keyed by the site key string, so that:
  //   - calling loadRecaptchaScript() multiple times for the SAME
  //     key (e.g. from several independent forms on the same page)
  //     only ever injects that key's <script> tag once, and
  //   - calling it for a DIFFERENT key (the multi-app simulation in
  //     app.js) loads an additional script tag for that key,
  //     without re-loading or interfering with keys already loaded.
  const scriptLoadPromisesByKey = new Map();

  function isPlaceholder(siteKey) {
    return !siteKey || siteKey.startsWith('__');
  }

  /**
   * Dynamically injects Google's reCAPTCHA loader script for the
   * given site key and resolves once it has finished loading.
   *
   * Safe to call multiple times, including concurrently and with
   * different site keys — each distinct key is only ever injected
   * once (see the Map comment above).
   *
   * @param {string} [siteKey]
   *   Defaults to `config.siteKey`. Only pass this explicitly if
   *   you are intentionally working with more than one site key on
   *   the same page (see the "MULTIPLE SITE KEYS" note at the top
   *   of this file, and app.js for the multi-application
   *   simulation that uses this).
   * @returns {Promise<void>}
   */
  function loadRecaptchaScript(siteKey) {
    const key = siteKey || config.siteKey;

    if (isPlaceholder(key)) {
      // Catches the common mistake of forgetting to replace a
      // "__RECAPTCHA_SITE_KEY__"-style placeholder from config.js
      // via the build pipeline — fails loudly and immediately
      // rather than silently sending a bad request to Google.
      return Promise.reject(
        new Error(
          `[recaptcha.js] Site key "${key}" is missing or still a placeholder value. ` +
            'Check that your build pipeline is injecting a real site key into ' +
            'js/config.js for this environment (see the comments in that file).'
        )
      );
    }

    const existing = scriptLoadPromisesByKey.get(key);
    if (existing) {
      log(`Script for site key "${key}" already loading/loaded — reusing existing promise.`);
      return existing;
    }

    const promise = new Promise((resolve, reject) => {
      // config.loaderScript switches between the current
      // 'enterprise.js' loader (default, used by migrated keys)
      // and the legacy 'api.js' loader (only needed if a key is
      // still un-migrated classic v3) — see config.js for the full
      // explanation. All keys loaded on one page are assumed to use
      // the same loader type; mixing loader types on one page is
      // not a supported/tested configuration.
      const loaderFile = config.loaderScript === 'api.js' ? 'api.js' : 'enterprise.js';
      const scriptUrl = `https://www.google.com/recaptcha/${loaderFile}?render=${encodeURIComponent(key)}`;

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
              `reCAPTCHA script for site key "${key}" to load. Check network connectivity and ` +
              'that https://www.google.com is reachable from this browser/network.'
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
            `[recaptcha.js] Failed to load the reCAPTCHA script for site key "${key}" from ` +
              `${scriptUrl}. Check network connectivity, any Content-Security-Policy ` +
              'restrictions (script-src / connect-src must allow https://www.google.com and ' +
              'https://www.gstatic.com), and that this site key is valid for this domain.'
          )
        );
      };

      document.head.appendChild(script);
      log(`Injecting script tag for site key "${key}": ${scriptUrl}`);
    });

    scriptLoadPromisesByKey.set(key, promise);
    return promise;
  }

  /**
   * Runs a reCAPTCHA assessment for the given action and resolves
   * with the resulting token, ready to send to your backend's
   * verification endpoint (see app.js for a full example,
   * and the companion recaptcha-backend project for the endpoint
   * that consumes this token).
   *
   * Automatically loads the Google script first if it has not been
   * loaded yet for the relevant site key — you do not need to call
   * loadRecaptchaScript() yourself before this, though you may want
   * to (see app.js) to "warm up" the script ahead of time, e.g. as
   * soon as a form comes into view, so the eventual submit click
   * does not have to wait for the network fetch.
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
   * @param {string} [siteKey]
   *   Defaults to `config.siteKey`. A normal single-application
   *   frontend never passes this. Only used by the multi-application
   *   simulation in app.js, to generate a token against a
   *   *different* application's site key on demand — see the
   *   "MULTIPLE SITE KEYS" note at the top of this file.
   *
   * @returns {Promise<string>} Resolves with the reCAPTCHA token.
   */
  async function executeRecaptcha(action, siteKey) {
    if (!action || typeof action !== 'string') {
      throw new TypeError('executeRecaptcha(action, siteKey?) requires a non-empty action string.');
    }

    const key = siteKey || config.siteKey;

    await loadRecaptchaScript(key);

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
      // `onload` fires) before it's safe to call `.execute()`. When
      // multiple site keys are loaded on the page, `.ready()` is
      // shared/global — by the time we reach this point,
      // `await loadRecaptchaScript(key)` above has already
      // guaranteed THIS key's script specifically has loaded.
      engine.ready(() => {
        const startedAt = window.performance ? window.performance.now() : Date.now();

        engine
          .execute(key, { action })
          .then((token) => {
            if (config.debug) {
              const elapsed = (window.performance ? window.performance.now() : Date.now()) - startedAt;
              log(`execute("${action}") for site key "${key}" resolved in ${elapsed.toFixed(0)}ms`);
            }
            resolve(token);
          })
          .catch((err) => {
            reject(
              new Error(
                `[recaptcha.js] grecaptcha execute("${action}") for site key "${key}" failed: ` +
                  `${err && err.message ? err.message : err}`
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

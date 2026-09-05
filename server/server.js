/**
 * server.js
 * ---------------------------------------------------------------
 * Minimal example server demonstrating how this project's pieces
 * fit together. In a real deployment, you will more likely import
 * `verifyRecaptchaToken` (from recaptchaVerification.js) directly
 * into your existing application's request handlers rather than
 * running this file standalone — this file exists so the whole
 * reference implementation is runnable and testable end to end.
 *
 * Run with:
 *   npm install
 *   cp .env.example .env   # then fill in real values
 *   npm start
 * ---------------------------------------------------------------
 */

'use strict';

// Importing `config` here first ensures configuration is validated
// (see config.js) and the process fails fast with a clear error
// message if something required is missing, before we even try to
// start listening for HTTP traffic.
const { config } = require('./config');

const express = require('express');
const verifyRouter = require('./routes/verify');

const app = express();
app.use(express.json());

app.use(verifyRouter);

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', env: config.appEnv });
});

app.listen(config.port, () => {
  console.log(
    `[server] reCAPTCHA verification service listening on port ${config.port} ` +
      `(env: ${config.appEnv}, GCP project number: ${config.projectNumber})`
  );
});

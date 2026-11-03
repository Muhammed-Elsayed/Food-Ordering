// Builds docs/api/openapi.json and docs/api/food-ordering.postman_collection.json.
// Run with `npm run docs:api` after changing an endpoint.
const fs = require('node:fs');
const path = require('node:path');

const outDir = path.resolve(__dirname, "../docs/api");
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const json = (schema, examples) => ({
  'application/json': {
    schema,
    ...(examples && { examples: Object.fromEntries(Object.entries(examples).map(([k, v]) => [k, { value: v }])) }),
  },
});
const err = (error, message, extra = {}) => ({ error, message, ...extra });

const user = {
  id: 'b6c1f0a2-3d4e-4f5a-8b9c-0d1e2f3a4b5c', email: 'sara@example.com', firstName: 'Sara', lastName: 'Adel',
  phone: '+201001234567', phoneVerified: false, emailVerified: true,
};
const session = {
  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiNmMxZjBhMiIsInNpZCI6IjdhOGIifQ.signature',
  refreshToken: 'q3VwX2hMZ0JkY3pPa2xYc2Z0bXJ0aE5uYlRvd1ZtY0c',
  tokenType: 'Bearer', expiresIn: 900, refreshTokenExpiresIn: 86400, user,
};

const rateLimitHeaders = {
  'Retry-After': { description: 'Seconds until the limit resets.', schema: { type: 'integer' } },
  RateLimit: { description: 'e.g. `limit=5, remaining=0, reset=900`', schema: { type: 'string' } },
  'RateLimit-Policy': { description: 'e.g. `5;w=900`', schema: { type: 'string' } },
};
const tooMany = message => ({
  description: 'Rate limited.', headers: rateLimitHeaders,
  content: json(ref('Error'), { rateLimited: err('TooManyRequestsError', message) }),
});
const badJson = err('BadRequestError', 'The request body must be valid JSON of at most 10 KB.');
const validation = fields => ({
  description: 'Invalid body. `fields` names every invalid field.',
  content: json(ref('ValidationError'), {
    invalidFields: err('BadRequestError', 'Some fields are invalid.', { fields }), invalidJson: badJson,
  }),
});
const unauthorizedToken = {
  description: 'Missing, invalid, or expired access token, or the session has ended.',
  content: json(ref('Error'), {
    missingToken: err('MissingTokenError', 'Missing authentication token, please login first'),
    expiredOrInvalid: err('InvalidTokenError', 'The provided token is invalid or expired, please login first'),
    sessionEnded: err('UnauthorizedError', 'Your session has ended. Log in again.'),
  }),
};
const missingConfig = key => ({
  description: 'Server is missing a secret in its configuration.',
  content: json(ref('Error'), { missingConfig: err('MissingConfigError', `Set ${key} in .env, then restart.`) }),
});
const sessionResponse = description => ({ description, content: json(ref('AuthSession'), { session }) });
const body = (schema, example) => ({ required: true, content: json(ref(schema), { example }) });
const pendingResponse = message => ({
  description: 'Code sent. In development it is printed to the server console.',
  content: json(ref('CodeSent'), { codeSent: { message, email: 'sara@example.com', expiresIn: 600 } }),
});

const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Food Ordering API',
    version: '1.0.0',
    license: { name: 'ISC' },
    description: [
      'Accounts and authentication for the Food Ordering backend.',
      '',
      '**Tokens.** Every login, verified sign-up, and refresh returns an `accessToken` (15 minutes) and a',
      '`refreshToken` (1 day, rotated on every use). Send the access token as `Authorization: Bearer <token>`.',
      'When a request returns 401 `InvalidTokenError`, call `POST /auth/refresh` once and retry.',
      '',
      '**Errors** have the shape `{ "error": "...", "message": "..." }`, sometimes with `fields`,',
      '`signInMethod`, or `attemptsLeft`. The two Google routes answer their own failures with `{ "message": "..." }`.',
      '',
      '**Email codes** are not emailed yet: the server prints them to its console.',
    ].join('\n'),
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
  tags: [
    { name: 'Health', description: 'Is the server up?' },
    { name: 'Sign-up', description: 'Email and password sign-up, confirmed with a 6-digit code.' },
    { name: 'Login and sessions', description: 'Password login, refresh, logout, and the current user.' },
    {
      name: 'Password',
      description: 'Change the password while logged in, or reset a forgotten one with an emailed code.',
    },
    { name: 'Google', description: 'Browser-only flow: open `/auth/google` in a browser, not in an API client.' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'], summary: 'Health check', operationId: 'health', security: [],
        description: 'Liveness only; does not touch the database.',
        responses: { 200: { description: 'The server is up.', content: json(ref('Health'), { ok: { status: 'ok' } }) } },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Sign-up'], summary: 'Start sign-up', operationId: 'register', security: [],
        description: [
          'Validates the details and emails a 6-digit code (valid 10 minutes). No account exists until',
          '`/auth/register/verify` succeeds. Registering again with the same email replaces the waiting sign-up.',
          '',
          'Rate limits: 10 per hour per IP, 5 per hour per email.',
        ].join('\n'),
        requestBody: body('RegisterRequest', {
          email: 'sara@example.com', password: 'correct horse battery', firstName: 'Sara', lastName: 'Adel', phone: '+201001234567',
        }),
        responses: {
          202: pendingResponse('We sent a 6-digit code to your email.'),
          400: validation({
            email: 'Enter a valid email address.', password: 'Use 8 to 128 characters.',
            firstName: 'Enter 1 to 50 characters.', lastName: 'Enter 1 to 50 characters.',
            phone: 'Use international format, for example +201001234567.',
          }),
          409: {
            description: 'The email already has an account. `signInMethod` says how to log in.',
            content: json(ref('ConflictError'), {
              password: err('ConflictError', 'This email is already registered. Log in with your email and password.', { signInMethod: 'password' }),
              google: err('ConflictError', 'This email is already registered with Google. Use Continue with Google.', { signInMethod: 'google' }),
            }),
          },
          429: tooMany('Too many sign-up attempts for this email. Try again later.'),
          503: missingConfig('OTP_SECRET_KEY'),
        },
      },
    },
    '/auth/register/verify': {
      post: {
        tags: ['Sign-up'], summary: 'Verify the code and create the account', operationId: 'verifyRegistration', security: [],
        description: [
          'Creates the account with `emailVerified: true` and logs it in. Five wrong codes end the code;',
          'ask for a new one with `/auth/register/resend`.',
          '',
          'Rate limit: 30 per 15 minutes per IP.',
        ].join('\n'),
        requestBody: body('VerifyRequest', { email: 'sara@example.com', code: '123456' }),
        responses: {
          201: sessionResponse('Account created and logged in.'),
          400: {
            description: 'Invalid body, wrong or expired code, or no sign-up waiting.',
            content: json({ anyOf: [ref('ValidationError'), ref('WrongCodeError'), ref('Error')] }, {
              wrongCode: err('BadRequestError', 'The code is wrong.', { attemptsLeft: 4 }),
              expired: err('BadRequestError', 'This code has expired. Ask for a new one.'),
              tooManyWrongCodes: err('BadRequestError', 'Too many wrong codes. Ask for a new one.'),
              noSignUp: err('BadRequestError', 'No sign-up is waiting for this email. Register again.'),
              invalidFields: err('BadRequestError', 'Some fields are invalid.', { fields: { code: 'Enter the 6-digit code from the email.' } }),
            }),
          },
          409: {
            description: 'The email got an account after the code was sent (for example with Google).',
            content: json(ref('ConflictError'), {
              google: err('ConflictError', 'This email is already registered with Google. Use Continue with Google.', { signInMethod: 'google' }),
            }),
          },
          429: tooMany('Too many verification attempts from your network. Try again later.'),
        },
      },
    },
    '/auth/register/resend': {
      post: {
        tags: ['Sign-up'], summary: 'Send a new code', operationId: 'resendCode', security: [],
        description: 'Replaces the code and resets the wrong-code count. Allowed once every 60 seconds.\n\nRate limits: 10 per hour per IP, 5 per hour per email.',
        requestBody: body('EmailRequest', { email: 'sara@example.com' }),
        responses: {
          202: pendingResponse('We sent a new code to your email.'),
          400: {
            description: 'Invalid email, or no sign-up waiting.',
            content: json({ anyOf: [ref('ValidationError'), ref('Error')] }, {
              noSignUp: err('BadRequestError', 'No sign-up is waiting for this email. Register again.'),
            }),
          },
          429: {
            description: 'Asked again within 60 seconds, or rate limited.', headers: rateLimitHeaders,
            content: json(ref('Error'), {
              cooldown: err('TooManyRequestsError', 'Wait 42 seconds before asking for another code.'),
              rateLimited: err('TooManyRequestsError', 'Too many code requests for this email. Try again later.'),
            }),
          },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Login and sessions'], summary: 'Log in with email and password', operationId: 'login', security: [],
        description: 'Creates a new session for this device; other devices stay logged in.\n\nRate limits: 20 per 15 minutes per IP, 5 failed per 15 minutes per email.',
        requestBody: body('LoginRequest', { email: 'sara@example.com', password: 'correct horse battery' }),
        responses: {
          200: sessionResponse('Logged in.'),
          400: validation({ email: 'Enter a valid email address.', password: 'Enter your password.' }),
          401: { description: 'Unknown email or wrong password (same answer for both).', content: json(ref('Error'), { invalid: err('UnauthorizedError', 'Invalid email or password.') }) },
          403: { description: 'Correct password, but the account is disabled.', content: json(ref('Error'), { disabled: err('ForbiddenError', 'This account is disabled.') }) },
          409: {
            description: 'The email belongs to a Google account.',
            content: json(ref('ConflictError'), { google: err('ConflictError', 'This email is already registered with Google. Use Continue with Google.', { signInMethod: 'google' }) }),
          },
          429: tooMany('Too many failed logins for this email. Try again later.'),
        },
      },
    },
    '/auth/password/change': {
      post: {
        tags: ['Password'], summary: 'Change the password (logged in)', operationId: 'changePassword',
        description: [
          'Checks the current password, sets the new one, keeps this device logged in, ends every other',
          'session, and emails the owner. The current tokens keep working. No email code is needed: the',
          'current password is the proof (use the Forgot password flow if it is unknown).',
          '',
          'A wrong current password is a 400 on `fields.currentPassword`, never a 401, so clients do not',
          'mistake it for an expired token.',
          '',
          'Rate limits: 20 per 15 minutes per IP, 5 wrong current passwords per 15 minutes per user.',
        ].join('\n'),
        requestBody: body('ChangePasswordRequest', { currentPassword: 'correct horse battery', newPassword: 'a brand new password' }),
        responses: {
          204: { description: 'Password changed. Other devices are signed out.' },
          400: validation({ currentPassword: 'Your current password is wrong.', newPassword: 'Use 8 to 128 characters.' }),
          401: unauthorizedToken,
          409: {
            description: 'A Google account (no password), or the password changed during the request.',
            content: json({ anyOf: [ref('ConflictError'), ref('Error')] }, {
              google: err('ConflictError', 'This account signs in with Google, so it has no password to change.', { signInMethod: 'google' }),
              changedMeanwhile: err('ConflictError', 'Your password changed while this request was running. Try again.'),
            }),
          },
          429: tooMany('Too many wrong current passwords. Try again later.'),
        },
      },
    },
    '/auth/password/forgot': {
      post: {
        tags: ['Password'], summary: 'Email a reset code', operationId: 'forgotPassword', security: [],
        description: [
          'Always answers 202 with the same body, so it never reveals which emails have accounts.',
          'Active password accounts get a 6-digit code (valid 10 minutes); Google accounts get a reminder to',
          'use Continue with Google; unknown or disabled accounts get nothing. Asking again within 60 seconds',
          'sends nothing new: use the code already sent.',
          '',
          'Rate limits: 10 per hour per IP, 5 per hour per email.',
        ].join('\n'),
        requestBody: body('EmailRequest', { email: 'sara@example.com' }),
        responses: {
          202: pendingResponse('If this email has a password account, we sent it a code.'),
          400: validation({ email: 'Enter a valid email address.' }),
          429: tooMany('Too many password reset requests for this email. Try again later.'),
        },
      },
    },
    '/auth/password/verify-code': {
      post: {
        tags: ['Password'], summary: 'Exchange the code for a reset token', operationId: 'verifyResetCode', security: [],
        description: [
          'Every failure (wrong, expired, or used-up code, or an email without a code) gets the same 400.',
          'Five wrong codes end the code. On success the code is used up.',
          '',
          'Rate limit: 30 per 15 minutes per IP.',
        ].join('\n'),
        requestBody: body('VerifyRequest', { email: 'sara@example.com', code: '123456' }),
        responses: {
          200: {
            description: 'Code accepted. Send the reset token to `/auth/password/reset` within 10 minutes.',
            content: json(ref('ResetToken'), { resetToken: { resetToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiNmMxIn0.signature', expiresIn: 600 } }),
          },
          400: {
            description: 'The code is not valid, or the body is invalid.',
            content: json({ anyOf: [ref('ValidationError'), ref('Error')] }, {
              invalidCode: err('BadRequestError', 'This code is wrong or has expired.'),
              invalidFields: err('BadRequestError', 'Some fields are invalid.', { fields: { code: 'Enter the 6-digit code from the email.' } }),
            }),
          },
          429: tooMany('Too many code attempts from your network. Try again later.'),
        },
      },
    },
    '/auth/password/reset': {
      post: {
        tags: ['Password'], summary: 'Set the new password and log in', operationId: 'resetPassword', security: [],
        description: [
          'Sets the new password, marks the email as verified, ends every session on every device, and logs',
          'this device in. The reset token works once.',
          '',
          'Rate limit: 10 per 15 minutes per IP.',
        ].join('\n'),
        requestBody: body('ResetPasswordRequest', { resetToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiNmMxIn0.signature', newPassword: 'a brand new password' }),
        responses: {
          200: sessionResponse('Password changed and logged in.'),
          400: {
            description: 'Invalid body, or the reset token is invalid, expired, or already used.',
            content: json({ anyOf: [ref('ValidationError'), ref('Error')] }, {
              expired: err('BadRequestError', 'This password reset has expired. Ask for a new code.'),
              invalidFields: err('BadRequestError', 'Some fields are invalid.', { fields: { newPassword: 'Use 8 to 128 characters.' } }),
            }),
          },
          429: tooMany('Too many password resets from your network. Try again later.'),
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Login and sessions'], summary: 'Get new tokens', operationId: 'refresh', security: [],
        description: 'Returns a new access token and a new refresh token. The refresh token you sent stops working.\n\nRate limit: 60 per 15 minutes per IP.',
        requestBody: body('RefreshRequest', { refreshToken: session.refreshToken }),
        responses: {
          200: sessionResponse('New tokens.'),
          400: validation({ refreshToken: 'Send the refresh token from your last login.' }),
          401: { description: 'Unknown, already used, or expired refresh token, or a disabled account.', content: json(ref('Error'), { sessionEnded: err('UnauthorizedError', 'Your session has ended. Log in again.') }) },
          429: tooMany('Too many refresh attempts from your network. Try again later.'),
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Login and sessions'], summary: 'Log out of every device', operationId: 'logout',
        description: 'Deletes every session of the user. All access and refresh tokens stop working immediately.',
        responses: { 204: { description: 'Logged out everywhere.' }, 401: unauthorizedToken, 503: missingConfig('JWT_SECRET_KEY') },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Login and sessions'], summary: 'Current user', operationId: 'me',
        responses: {
          200: { description: 'The logged-in user.', content: json(ref('MeResponse'), { me: { user } }) },
          401: unauthorizedToken,
          503: missingConfig('JWT_SECRET_KEY'),
        },
      },
    },
    '/auth/google': {
      get: {
        tags: ['Google'], summary: 'Start Continue with Google (browser only)', operationId: 'googleStart', security: [],
        description: 'Redirects to Google and sets an `oauth_browser` cookie. Open this URL in a browser; after you pick an account, Google sends you to `/auth/google/callback`, which shows the session JSON. Copy `accessToken` and `refreshToken` from there.',
        responses: {
          302: { description: 'Redirect to Google.', headers: { Location: { schema: { type: 'string', format: 'uri' } } } },
          500: { description: 'Could not start.', content: json(ref('MessageError'), { failed: { message: 'Could not start authorization. Try again.' } }) },
          503: { description: 'Google client not configured.', content: json(ref('MessageError'), { missing: { message: 'Set OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET in .env, then restart.' } }) },
        },
      },
    },
    '/auth/google/callback': {
      get: {
        tags: ['Google'], summary: 'Google redirects here (browser only)', operationId: 'googleCallback', security: [],
        description: 'Called by Google, not by you. Needs the cookie set by `/auth/google` in the same browser.',
        parameters: [
          { name: 'state', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'code', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'error', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          200: sessionResponse('Logged in to an existing account.'),
          201: sessionResponse('First Google login: account created and logged in.'),
          400: { description: 'Unknown, used, or expired attempt; or Google returned no code.', content: json(ref('MessageError'), { invalid: { message: 'Invalid or expired attempt. Start again at /auth/google.' } }) },
          401: { description: 'Google identity failed verification.', content: json(ref('MessageError'), { unverified: { message: 'Could not verify the Google identity. Start again at /auth/google.' } }) },
          403: { description: 'New account, but the Google email is not verified; or the account is disabled.', content: json(ref('Error'), { emailNotVerified: err('ForbiddenError', "Your Google account's email is not verified, so it cannot be used to create an account."), disabled: err('ForbiddenError', 'This account is disabled.') }) },
          409: { description: 'The email belongs to another account.', content: json(ref('ConflictError'), { password: err('ConflictError', 'This email is registered with a password. Log in with your email and password.', { signInMethod: 'password' }) }) },
          502: { description: 'Token exchange with Google failed.', content: json(ref('MessageError'), { failed: { message: 'Token exchange failed. Check the client settings and start again at /auth/google.' } }) },
        },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Health: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } } },
      User: {
        type: 'object', required: ['id', 'email', 'firstName', 'lastName', 'phone', 'phoneVerified', 'emailVerified'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          firstName: { type: 'string', nullable: true },
          lastName: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true, description: 'E.164, e.g. +201001234567' },
          phoneVerified: { type: 'boolean' },
          emailVerified: { type: 'boolean' },
        },
      },
      AuthSession: {
        type: 'object', required: ['accessToken', 'refreshToken', 'tokenType', 'expiresIn', 'refreshTokenExpiresIn', 'user'],
        properties: {
          accessToken: { type: 'string', description: 'JWT. Send as `Authorization: Bearer <token>`.' },
          refreshToken: { type: 'string', description: 'Send to `/auth/refresh`. Single use.' },
          tokenType: { type: 'string', enum: ['Bearer'] },
          expiresIn: { type: 'integer', description: 'Access token lifetime in seconds.', example: 900 },
          refreshTokenExpiresIn: { type: 'integer', description: 'Refresh token lifetime in seconds.', example: 86400 },
          user: ref('User'),
        },
      },
      MeResponse: { type: 'object', required: ['user'], properties: { user: ref('User') } },
      CodeSent: {
        type: 'object', required: ['message', 'email', 'expiresIn'],
        properties: {
          message: { type: 'string' },
          email: { type: 'string', format: 'email', description: 'Normalized (trimmed, lowercase).' },
          expiresIn: { type: 'integer', description: 'Code lifetime in seconds.', example: 600 },
        },
      },
      RegisterRequest: {
        type: 'object', required: ['email', 'password', 'firstName', 'lastName'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254, description: 'Trimmed and lowercased by the server.' },
          password: { type: 'string', minLength: 8, maxLength: 128 },
          firstName: { type: 'string', minLength: 1, maxLength: 50 },
          lastName: { type: 'string', minLength: 1, maxLength: 50 },
          phone: { type: 'string', nullable: true, description: 'Optional. International format; spaces, dashes, and brackets are removed.' },
        },
      },
      VerifyRequest: {
        type: 'object', required: ['email', 'code'],
        properties: { email: { type: 'string', format: 'email' }, code: { type: 'string', pattern: '^[0-9]{6}$' } },
      },
      EmailRequest: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } },
      LoginRequest: {
        type: 'object', required: ['email', 'password'],
        properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 1, maxLength: 128 } },
      },
      ResetToken: {
        type: 'object', required: ['resetToken', 'expiresIn'],
        properties: {
          resetToken: { type: 'string', description: 'Single-use. Only accepted by `/auth/password/reset`.' },
          expiresIn: { type: 'integer', description: 'Seconds the reset token is valid.', example: 600 },
        },
      },
      ChangePasswordRequest: {
        type: 'object', required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 1, maxLength: 128 },
          newPassword: { type: 'string', minLength: 8, maxLength: 128 },
        },
      },
      ResetPasswordRequest: {
        type: 'object', required: ['resetToken', 'newPassword'],
        properties: {
          resetToken: { type: 'string', maxLength: 1000 },
          newPassword: { type: 'string', minLength: 8, maxLength: 128 },
        },
      },
      RefreshRequest: {
        type: 'object', required: ['refreshToken'],
        properties: { refreshToken: { type: 'string', maxLength: 100 } },
      },
      Error: {
        type: 'object', required: ['error', 'message'],
        properties: { error: { type: 'string', example: 'BadRequestError' }, message: { type: 'string' } },
      },
      ValidationError: {
        allOf: [ref('Error'), {
          type: 'object',
          properties: { fields: { type: 'object', additionalProperties: { type: 'string' }, description: 'Field name to problem.' } },
        }],
      },
      ConflictError: {
        allOf: [ref('Error'), {
          type: 'object', required: ['signInMethod'],
          properties: { signInMethod: { type: 'string', enum: ['google', 'password'], description: 'How this email logs in.' } },
        }],
      },
      WrongCodeError: {
        allOf: [ref('Error'), { type: 'object', required: ['attemptsLeft'], properties: { attemptsLeft: { type: 'integer', minimum: 0 } } }],
      },
      MessageError: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
    },
  },
  security: [{ bearerAuth: [] }],
};

// Postman collection: the same requests, with scripts that store the tokens as global
// variables, so they work whichever environment is selected. Apidog does not support
// Postman's collection variables, so the collection relies only on globals and {{baseUrl}}.
const saveTokens = [
  'if (pm.response.code === 200 || pm.response.code === 201) {',
  '  const session = pm.response.json();',
  '  pm.globals.set("accessToken", session.accessToken);',
  '  pm.globals.set("refreshToken", session.refreshToken);',
  '}',
];
const bearer = { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] };
const account = { email: 'sara@example.com', password: 'correct horse battery' };
const raw = value => ({ mode: 'raw', raw: JSON.stringify(value, null, 2), options: { raw: { language: 'json' } } });
const request = (name, method, urlPath, { body: requestBody, auth = false, tests, description } = {}) => ({
  name,
  ...(tests && { event: [{ listen: 'test', script: { type: 'text/javascript', exec: tests } }] }),
  request: {
    method,
    auth: auth ? bearer : { type: 'noauth' },
    header: requestBody ? [{ key: 'Content-Type', value: 'application/json' }] : [],
    ...(requestBody && { body: raw(requestBody) }),
    url: { raw: `{{baseUrl}}${urlPath}`, host: ['{{baseUrl}}'], path: urlPath.split('/').filter(Boolean) },
    ...(description && { description }),
  },
});
const collection = {
  info: {
    name: 'Food Ordering API',
    description: [
      'Run in order: Register → paste the 6-digit code from the server console into',
      'the Verify body → Verify. Verify, Login, and Refresh save `accessToken` and `refreshToken` to the',
      'global variables; Me, Logout, and Refresh use them. Password reset saves `resetToken` the same way.',
    ].join('\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [{ key: 'baseUrl', value: 'http://localhost:3000' }],
  item: [
    request('Health', 'GET', '/health'),
    {
      name: 'Sign-up',
      item: [
        request('Register', 'POST', '/auth/register', {
          body: { ...account, firstName: 'Sara', lastName: 'Adel', phone: '+201001234567' },
          description: 'The code is printed in the server console. Paste it into the Verify body.',
        }),
        request('Verify code', 'POST', '/auth/register/verify', { body: { email: account.email, code: 'PASTE-CODE' }, tests: saveTokens }),
        request('Resend code', 'POST', '/auth/register/resend', { body: { email: account.email } }),
      ],
    },
    {
      name: 'Login and sessions',
      item: [
        request('Login', 'POST', '/auth/login', { body: account, tests: saveTokens }),
        request('Me', 'GET', '/auth/me', { auth: true }),
        request('Refresh', 'POST', '/auth/refresh', { body: { refreshToken: '{{refreshToken}}' }, tests: saveTokens }),
        request('Logout (all devices)', 'POST', '/auth/logout', {
          auth: true,
          tests: [
            'if (pm.response.code === 204) {',
            '  pm.globals.set("accessToken", "");',
            '  pm.globals.set("refreshToken", "");',
            '}',
          ],
        }),
      ],
    },
    {
      name: 'Password',
      item: [
        request('Change password', 'POST', '/auth/password/change', {
          auth: true, body: { currentPassword: account.password, newPassword: 'a brand new password' },
          description: 'Logged in. Keeps this device logged in and signs out the others.',
        }),
        request('Forgot password', 'POST', '/auth/password/forgot', {
          body: { email: account.email },
          description: 'The code is printed in the server console. Paste it into the Verify reset code body.',
        }),
        request('Verify reset code', 'POST', '/auth/password/verify-code', {
          body: { email: account.email, code: 'PASTE-CODE' },
          tests: ['if (pm.response.code === 200) pm.globals.set("resetToken", pm.response.json().resetToken);'],
        }),
        request('Reset password', 'POST', '/auth/password/reset', {
          body: { resetToken: '{{resetToken}}', newPassword: 'a brand new password' }, tests: saveTokens,
        }),
      ],
    },
    {
      name: 'Google (open in a browser)',
      item: [
        request('Start Google login', 'GET', '/auth/google', {
          description: 'Browser only. Open {{baseUrl}}/auth/google in a browser, then copy accessToken and refreshToken from the JSON page into the collection variables.',
        }),
      ],
    },
  ],
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'openapi.json'), JSON.stringify(openapi, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'food-ordering.postman_collection.json'), JSON.stringify(collection, null, 2) + '\n');
console.log('wrote', outDir);

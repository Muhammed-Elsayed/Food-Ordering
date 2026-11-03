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

const option = (id, name, extraPrice, isAvailable = true) => ({ id, name, extraPrice, isAvailable });
const sizeGroup = {
  id: '4b1d2c3e-0000-4000-8000-000000000040', name: 'Size', minSelect: 1, maxSelect: 1,
  options: [option('4b1d2c3e-0000-4000-8000-000000000051', 'Medium', 0), option('4b1d2c3e-0000-4000-8000-000000000050', 'Large', 6000)],
};
const pizzaHut = {
  id: '4b1d2c3e-0000-4000-8000-000000000010', slug: 'pizza-hut', name: 'Pizza Hut', description: 'Pizza, sides, and drinks.',
  logoUrl: 'https://cdn.example.com/restaurants/pizza-hut/logo.png', coverUrl: null,
  categories: [{ slug: 'pizza', name: 'Pizza' }], currency: 'EGP', deliveryFee: 2500, minimumOrder: 15000,
  deliveryMinutes: { min: 30, max: 45 }, isOpen: true,
};
const buffaloBurger = {
  ...pizzaHut, id: '4b1d2c3e-0000-4000-8000-000000000011', slug: 'buffalo-burger', name: 'Buffalo Burger',
  description: 'Burgers, fries, and shakes.', logoUrl: 'https://cdn.example.com/restaurants/buffalo-burger/logo.png',
  categories: [{ slug: 'burger', name: 'Burger' }], deliveryFee: 2000, minimumOrder: 0, deliveryMinutes: { min: 25, max: 40 },
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
      'Accounts, authentication, and restaurant browsing for the Food Ordering backend.',
      '',
      '**Money.** Prices, fees, and minimum orders are whole numbers in the smallest unit of the',
      "restaurant's `currency` (piasters for EGP): `12500` is 125.00 EGP.",
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
    { name: 'Browse', description: 'Categories, restaurants, and menus. Public: no login needed.' },
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
    '/categories': {
      get: {
        tags: ['Browse'], summary: 'List categories', operationId: 'listCategories', security: [],
        description: 'Active categories in display order.',
        responses: {
          200: {
            description: 'The categories.',
            content: json(ref('CategoryList'), { categories: { categories: [
              { id: '4b1d2c3e-0000-4000-8000-000000000002', slug: 'burger', name: 'Burger', imageUrl: 'https://cdn.example.com/categories/burger.png' },
              { id: '4b1d2c3e-0000-4000-8000-000000000001', slug: 'pizza', name: 'Pizza', imageUrl: 'https://cdn.example.com/categories/pizza.png' },
            ] } }),
          },
        },
      },
    },
    '/restaurants': {
      get: {
        tags: ['Browse'], summary: 'List restaurants', operationId: 'listRestaurants', security: [],
        description: [
          'Active restaurants in display order, a page at a time. `isOpen` is true when the restaurant is taking',
          'orders and it is within its opening hours, in its own time zone.',
          '',
          'An unknown category returns an empty list, not an error.',
        ].join('\n'),
        parameters: [
          { name: 'category', in: 'query', required: false, description: 'Category slug, e.g. `pizza`. Case and surrounding spaces are ignored.', schema: { type: 'string', example: 'pizza' } },
          { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
        ],
        responses: {
          200: {
            description: 'One page of restaurants. `total` counts every match.',
            content: json(ref('RestaurantPage'), { restaurants: { restaurants: [buffaloBurger, pizzaHut], page: 1, limit: 20, total: 2 } }),
          },
          400: {
            description: 'Invalid query. `fields` names every invalid parameter.',
            content: json(ref('ValidationError'), {
              invalidFields: err('BadRequestError', 'Some fields are invalid.', { fields: {
                category: 'Use a category slug, for example pizza.', page: 'Use a whole number from 1 to 10000.',
                limit: 'Use a whole number from 1 to 50.',
              } }),
            }),
          },
        },
      },
    },
    '/restaurants/{slug}': {
      get: {
        tags: ['Browse'], summary: 'Restaurant page with its menu', operationId: 'getRestaurant', security: [],
        description: [
          'The restaurant, its opening hours, and its menu: sections → items → option groups → options.',
          '',
          '- Removed items, options, and sections are left out; so are sections with no items and option groups with no options.',
          '- Sold-out items and options are included with `isAvailable: false`. An item is also unavailable while a',
          '  required option group (`minSelect` ≥ 1) has too few available options.',
          '- The customer picks `minSelect` to `maxSelect` options from each group. An option adds `extraPrice` to the item price.',
        ].join('\n'),
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string', example: 'pizza-hut' } }],
        responses: {
          200: {
            description: 'The restaurant and its menu.',
            content: json(ref('RestaurantPageResponse'), { pizzaHut: {
              restaurant: {
                ...pizzaHut, phone: '+201001234567',
                openingHours: [0, 1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ dayOfWeek, opens: '12:00', closes: '02:00' })),
              },
              menu: [
                {
                  id: '4b1d2c3e-0000-4000-8000-000000000021', name: 'Pizzas', description: 'Hand-stretched dough.',
                  items: [{
                    id: '4b1d2c3e-0000-4000-8000-000000000031', name: 'Margherita', description: 'Tomato sauce and mozzarella.',
                    imageUrl: 'https://cdn.example.com/items/margherita.jpg', price: 14000, isAvailable: true,
                    optionGroups: [sizeGroup, {
                      id: '4b1d2c3e-0000-4000-8000-000000000041', name: 'Extra toppings', minSelect: 0, maxSelect: 3,
                      options: [option('4b1d2c3e-0000-4000-8000-000000000052', 'Olives', 1500), option('4b1d2c3e-0000-4000-8000-000000000053', 'Mushrooms', 1500, false)],
                    }],
                  }],
                },
                {
                  id: '4b1d2c3e-0000-4000-8000-000000000020', name: 'Sides', description: null,
                  items: [{
                    id: '4b1d2c3e-0000-4000-8000-000000000033', name: 'Garlic bread', description: null, imageUrl: null,
                    price: 4000, isAvailable: false, optionGroups: [],
                  }],
                },
              ],
            } }),
          },
          404: { description: 'No active restaurant has this slug.', content: json(ref('Error'), { notFound: err('NotFoundError', 'This restaurant does not exist.') }) },
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
      Category: {
        type: 'object', required: ['id', 'slug', 'name', 'imageUrl'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          slug: { type: 'string', description: 'Use as `?category=` on `/restaurants`.' },
          name: { type: 'string' },
          imageUrl: { type: 'string', format: 'uri', nullable: true },
        },
      },
      CategoryList: { type: 'object', required: ['categories'], properties: { categories: { type: 'array', items: ref('Category') } } },
      RestaurantSummary: {
        type: 'object',
        required: ['id', 'slug', 'name', 'description', 'logoUrl', 'coverUrl', 'categories', 'currency', 'deliveryFee', 'minimumOrder', 'deliveryMinutes', 'isOpen'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          slug: { type: 'string', description: 'Use in `/restaurants/{slug}`.' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          logoUrl: { type: 'string', format: 'uri', nullable: true },
          coverUrl: { type: 'string', format: 'uri', nullable: true },
          categories: {
            type: 'array',
            items: { type: 'object', required: ['slug', 'name'], properties: { slug: { type: 'string' }, name: { type: 'string' } } },
          },
          currency: { type: 'string', description: 'ISO 4217 code.', example: 'EGP' },
          deliveryFee: { type: 'integer', description: 'Smallest currency unit.', example: 2500 },
          minimumOrder: { type: 'integer', description: 'Smallest currency unit; 0 means no minimum.', example: 15000 },
          deliveryMinutes: {
            type: 'object', required: ['min', 'max'], description: 'Estimated delivery time, e.g. 30–45 minutes.',
            properties: { min: { type: 'integer' }, max: { type: 'integer' } },
          },
          isOpen: { type: 'boolean', description: 'Taking orders and within opening hours right now.' },
        },
      },
      RestaurantPage: {
        type: 'object', required: ['restaurants', 'page', 'limit', 'total'],
        properties: {
          restaurants: { type: 'array', items: ref('RestaurantSummary') },
          page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer', description: 'Matches across all pages.' },
        },
      },
      OpeningPeriod: {
        type: 'object', required: ['dayOfWeek', 'opens', 'closes'],
        description: "In the restaurant's time zone. When `closes` is not after `opens`, the period ends the next day.",
        properties: {
          dayOfWeek: { type: 'integer', minimum: 0, maximum: 6, description: '0 = Sunday.' },
          opens: { type: 'string', example: '12:00' },
          closes: { type: 'string', example: '02:00', description: '`24:00` means midnight.' },
        },
      },
      RestaurantDetails: {
        allOf: [ref('RestaurantSummary'), {
          type: 'object', required: ['phone', 'openingHours'],
          properties: {
            phone: { type: 'string', nullable: true, description: 'E.164' },
            openingHours: { type: 'array', items: ref('OpeningPeriod'), description: 'A day with no periods is closed.' },
          },
        }],
      },
      MenuOption: {
        type: 'object', required: ['id', 'name', 'extraPrice', 'isAvailable'],
        properties: {
          id: { type: 'string', format: 'uuid' }, name: { type: 'string' },
          extraPrice: { type: 'integer', description: 'Added to the item price. Smallest currency unit.' },
          isAvailable: { type: 'boolean', description: 'False while sold out.' },
        },
      },
      OptionGroup: {
        type: 'object', required: ['id', 'name', 'minSelect', 'maxSelect', 'options'],
        properties: {
          id: { type: 'string', format: 'uuid' }, name: { type: 'string' },
          minSelect: { type: 'integer', minimum: 0, description: 'At least this many options; 1 or more means required.' },
          maxSelect: { type: 'integer', minimum: 1 },
          options: { type: 'array', items: ref('MenuOption') },
        },
      },
      MenuItem: {
        type: 'object', required: ['id', 'name', 'description', 'imageUrl', 'price', 'isAvailable', 'optionGroups'],
        properties: {
          id: { type: 'string', format: 'uuid' }, name: { type: 'string' },
          description: { type: 'string', nullable: true },
          imageUrl: { type: 'string', format: 'uri', nullable: true },
          price: { type: 'integer', description: 'Smallest currency unit.' },
          isAvailable: { type: 'boolean', description: 'False while sold out or while a required choice has too few options left.' },
          optionGroups: { type: 'array', items: ref('OptionGroup') },
        },
      },
      MenuSection: {
        type: 'object', required: ['id', 'name', 'description', 'items'],
        properties: {
          id: { type: 'string', format: 'uuid' }, name: { type: 'string' },
          description: { type: 'string', nullable: true },
          items: { type: 'array', items: ref('MenuItem') },
        },
      },
      RestaurantPageResponse: {
        type: 'object', required: ['restaurant', 'menu'],
        properties: { restaurant: ref('RestaurantDetails'), menu: { type: 'array', items: ref('MenuSection') } },
      },
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
    url: {
      raw: `{{baseUrl}}${urlPath}`, host: ['{{baseUrl}}'], path: urlPath.split('?')[0].split('/').filter(Boolean),
      ...(urlPath.includes('?') && {
        query: [...new URLSearchParams(urlPath.split('?')[1])].map(([key, value]) => ({ key, value })),
      }),
    },
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
      name: 'Browse',
      item: [
        request('Categories', 'GET', '/categories'),
        request('Restaurants', 'GET', '/restaurants?page=1&limit=20'),
        request('Restaurants in a category', 'GET', '/restaurants?category=pizza'),
        request('Restaurant page and menu', 'GET', '/restaurants/pizza-hut'),
      ],
    },
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

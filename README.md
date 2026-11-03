# Food Ordering

A food ordering backend in the spirit of DoorDash, built step by step with Express 5,
TypeScript, Prisma 7, and PostgreSQL.

> **Status:** early development. Accounts and authentication are done; restaurants, menus,
> carts, and orders come next.

## Features

- **Continue with Google**: OpenID Connect with PKCE, state, nonce, and a browser-bound
  cookie. The first login creates the account.
- **Email and password sign-up** confirmed with a 6-digit code sent by email. The account
  exists only after the code is verified, so nobody can claim someone else's email.
- **Change password** while logged in: keeps the current device signed in, signs out the
  others, and emails the owner.
- **Forgot password**: a 6-digit code by email, exchanged for a single-use reset token. The
  answer never reveals whether an email has an account, and a reset signs out every device.
- **Sessions on multiple devices**: 15-minute access tokens and 1-day refresh tokens that
  rotate on every use. Logout signs out every device.
- **One login method per account**: an email registered with Google can't log in with a
  password, and the other way round. The API tells the client which method to use.
- **Abuse protection**: per-IP and per-email rate limits, argon2id password hashing, and
  login responses that take as long for unknown emails as for wrong passwords.
- **Database constraints** for normalized emails, E.164 phone numbers, and hashed tokens and
  codes.

## Getting started

### Requirements

- Node.js 22 or later
- PostgreSQL 14 or later
- A Google Cloud OAuth client of type **Web application** (only for Continue with Google)

### Setup

```bash
git clone https://github.com/Muhammed-Elsayed/Food-Ordering.git
cd Food-Ordering
npm install
cp .env.example .env    # then fill it in, see below
npm run db:deploy       # create the tables
npm run dev             # http://localhost:3000
```

Create an empty PostgreSQL database first and put its URL in `.env`. See
[prisma/README.md](prisma/README.md) for database details.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET_KEY` | yes | Signs access tokens. Use a long random value |
| `OTP_SECRET_KEY` | yes | Keys the hashes of email codes. Use a different long random value |
| `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | for Google | From your Google OAuth client |
| `OAUTH_REDIRECT_URI` | no | Defaults to `http://localhost:3000/auth/google/callback`; register the same URL with Google |
| `PORT` | no | Defaults to `3000` |

Generate a random secret with:

```bash
node -e "console.log(require('node:crypto').randomBytes(64).toString('base64url'))"
```

> Emails are not sent yet. In development, verification codes are printed to the server
> console.

## API

To try the API in Apidog, Postman, or Swagger UI, import
[docs/api/openapi.json](docs/api/openapi.json) (full spec with schemas and examples) or
[docs/api/food-ordering.postman_collection.json](docs/api/food-ordering.postman_collection.json)
(ready-to-send requests that save the tokens for you).

All bodies are JSON. Errors look like `{ "error": "BadRequestError", "message": "..." }`,
sometimes with more fields such as `fields`, `signInMethod`, or `attemptsLeft`.

| Method and path | Auth | Body | Success |
| --- | --- | --- | --- |
| `GET /health` | | | `200 { status: "ok" }` |
| `GET /auth/google` | | | Redirects to Google |
| `GET /auth/google/callback` | | | `201` new account or `200`, with a session |
| `POST /auth/register` | | `email, password, firstName, lastName, phone?` | `202`, code emailed |
| `POST /auth/register/verify` | | `email, code` | `201` with a session |
| `POST /auth/register/resend` | | `email` | `202`, new code emailed |
| `POST /auth/login` | | `email, password` | `200` with a session |
| `POST /auth/password/change` | Bearer | `currentPassword, newPassword` | `204`, other devices signed out |
| `POST /auth/password/forgot` | | `email` | Always `202`; code emailed to password accounts |
| `POST /auth/password/verify-code` | | `email, code` | `200 { resetToken, expiresIn }` |
| `POST /auth/password/reset` | | `resetToken, newPassword` | `200` with a session |
| `POST /auth/refresh` | | `refreshToken` | `200` with a new session |
| `POST /auth/logout` | Bearer | | `204`, every device signed out |
| `GET /auth/me` | Bearer | | `200 { user }` |

A session response looks like this:

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "q3V...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "refreshTokenExpiresIn": 86400,
  "user": {
    "id": "b6c1...", "email": "sara@example.com", "firstName": "Sara", "lastName": "Adel",
    "phone": "+201001234567", "phoneVerified": false, "emailVerified": true
  }
}
```

Send the access token as `Authorization: Bearer <accessToken>`. When it expires, call
`/auth/refresh` with the refresh token. Each refresh returns a new refresh token, and the
old one stops working. A refresh token not used for a day expires, and the user must log in
again.

### Sign-up with email

1. `POST /auth/register`. The server emails a 6-digit code that is valid for 10 minutes.
2. `POST /auth/register/verify` with the code. Five wrong codes end that code.
3. If the code didn't arrive or expired, `POST /auth/register/resend` (once a minute).

Passwords need 8 to 128 characters. Phone numbers are optional and use international
format, for example `+201001234567`.

### Change password

`POST /auth/password/change` with the access token and `{ currentPassword, newPassword }`.
No email code is needed: the current password is the proof. The current tokens keep working; every other device is signed out, and the owner gets an
email. A wrong current password returns `400` with `fields.currentPassword` (not `401`, so
clients don't mistake it for an expired token). Google accounts get `409`.

### Forgot password

1. `POST /auth/password/forgot`. Always answers `202` with the same body. Password accounts get
   a 6-digit code valid for 10 minutes; Google accounts get a reminder to use Google. Asking
   again within a minute sends nothing new.
2. `POST /auth/password/verify-code` with the code. Any failure returns the same `400`; five
   wrong codes end the code. Success returns a `resetToken` valid for 10 minutes.
3. `POST /auth/password/reset` with the `resetToken` and `newPassword`. Every existing session
   ends, and the response is a new session for this device. The reset token works once.

### Rate limits

Over a limit, the API returns `429` with a `Retry-After` header.

| Endpoint | Per IP | Per email |
| --- | --- | --- |
| `POST /auth/login` | 20 per 15 min | 5 failed per 15 min |
| `POST /auth/register` | 10 per hour | 5 per hour |
| `POST /auth/register/verify` | 30 per 15 min | 5 wrong codes per code |
| `POST /auth/register/resend` | 10 per hour | 5 per hour |
| `POST /auth/password/change` | 20 per 15 min | 5 wrong current passwords per 15 min (per user) |
| `POST /auth/password/forgot` | 10 per hour | 5 per hour |
| `POST /auth/password/verify-code` | 30 per 15 min | 5 wrong codes per code |
| `POST /auth/password/reset` | 10 per 15 min | |
| `POST /auth/refresh` | 60 per 15 min | |

## Tests

```bash
npm test          # unit and API tests, no database or network needed
npm run test:db   # database constraint tests against DATABASE_URL (rolled back)
```

## Project structure

```
src/
  app.ts, index.ts   app setup and server start
  routes/            endpoints
  controllers/       HTTP handling
  services/          business rules and database queries
  middleware/        auth, Google OAuth, rate limits, validation, errors
  schemas/           types and request validation
  utilities/         errors, passwords, tokens, codes, email
  config/            settings from the environment
prisma/              database schema and migrations
tests/
```

## Roadmap

- [x] Google and email/password accounts
- [x] Email verification codes
- [x] Multi-device sessions with refresh tokens and logout
- [x] Change and reset password
- [ ] Real email delivery
- [ ] Profile updates and phone verification
- [ ] Restaurants and menus
- [ ] Cart and checkout
- [ ] Orders and delivery tracking

## License

ISC

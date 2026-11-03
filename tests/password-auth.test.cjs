const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { setup, jwtSecret, linkedUser } = require('./app-harness.cjs');

const password = 'correct horse battery';
const registration = {
  email: ' Cook@Example.com ', password, firstName: ' Sara ', lastName: 'Adel', phone: '+20 (100) 123-4567',
};
const email = 'cook@example.com';
const wrongCode = code => (code === '000000' ? '111111' : '000000');

test('register emails a code and creates the account only once the code is verified', async () => {
  const app = setup(undefined, { users: [] });
  const res = await app.register(registration);
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.email, email);
  assert.equal(res.body.expiresIn, 600);
  assert.equal(app.users.length, 0);

  const code = app.lastCode(email);
  assert.match(code, /^\d{6}$/);
  const [pending] = app.pendingRegistrations;
  const [emailCode] = app.emailCodes;
  assert.match(pending.passwordHash, /^\$argon2id\$/);
  assert.equal(emailCode.purpose, 'register');
  assert.match(emailCode.codeHash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify([res.body, pending, emailCode]), new RegExp(`${code}|${password}`));

  const verified = await app.verify({ email: registration.email, code });
  assert.equal(verified.statusCode, 201);
  const [created] = app.users;
  assert.deepEqual({ ...verified.body.user }, {
    id: created.id, email, firstName: 'Sara', lastName: 'Adel',
    phone: '+201001234567', phoneVerified: false, emailVerified: true,
  });
  assert.equal(created.passwordHash, pending.passwordHash);
  assert.equal(created.googleSub, null);
  assert.equal(app.pendingRegistrations.length, 0);
  assert.equal(app.emailCodes.length, 0);
  assert.equal(verified.body.expiresIn, 900);
  assert.equal(verified.body.refreshTokenExpiresIn, 86400);
  assert.equal(typeof verified.body.refreshToken, 'string');
  const payload = jwt.verify(verified.body.accessToken, jwtSecret, { algorithms: ['HS256'], audience: 'access' });
  assert.equal(payload.sub, created.id);
  assert.equal(payload.sid, app.sessions[0].id);
  assert.equal((await app.me(`Bearer ${verified.body.accessToken}`)).statusCode, 200);
});

test('phone is optional at registration', async () => {
  for (const phone of [undefined, null, '', '   ']) {
    const app = setup(undefined, { users: [] });
    assert.equal((await app.signUp({ ...registration, phone })).statusCode, 201, String(phone));
    assert.equal(app.users[0].phone, null);
  }
});

test('register reports every invalid field and stores nothing', async () => {
  const app = setup(undefined, { users: [] });
  const res = await app.register({ email: 'not-an-email', password: 'short', firstName: '  ', phone: '0100 123 4567' });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(Object.keys(res.body.fields).sort(), ['email', 'firstName', 'lastName', 'password', 'phone']);
  for (const body of [undefined, 'text', { ...registration, password: 'x'.repeat(129) },
    { ...registration, firstName: 'x'.repeat(51) }, { ...registration, phone: 201001234567 }]) {
    assert.equal((await app.register(body)).statusCode, 400);
  }
  assert.equal(app.pendingRegistrations.length, 0);
  assert.equal(app.emails.length, 0);
});

test('an email registered either way cannot be registered again, and no code is sent', async () => {
  const app = setup(undefined, { users: [] });
  await app.signUp(registration);
  const again = await app.register({ ...registration, email: 'COOK@example.com', password: 'another password' });
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.signInMethod, 'password');
  assert.equal(app.emails.length, 1);

  const googleApp = setup();
  const res = await googleApp.register({ ...registration, email: linkedUser.email });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.signInMethod, 'google');
  assert.equal(googleApp.emails.length, 0);
  assert.equal(googleApp.pendingRegistrations.length, 0);
});

test('wrong codes count down, and the fifth ends the code', async () => {
  const app = setup(undefined, { users: [] });
  await app.register(registration);
  const code = app.lastCode(email);
  for (let left = 4; left >= 0; left--) {
    const res = await app.verify({ email, code: wrongCode(code) });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.attemptsLeft, left);
  }
  const res = await app.verify({ email, code });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Too many wrong codes/);
  assert.equal(app.users.length, 0);
});

test('codes expire after 10 minutes; resend waits 60 seconds and replaces the code', async () => {
  const app = setup(undefined, { users: [] });
  await app.register(registration);
  const first = app.lastCode(email);

  const tooSoon = await app.resend({ email });
  assert.equal(tooSoon.statusCode, 429);
  assert.match(tooSoon.body.message, /Wait 60 seconds/);

  app.advance(61);
  assert.equal((await app.resend({ email })).statusCode, 202);
  const second = app.lastCode(email);
  if (second !== first) assert.equal((await app.verify({ email, code: first })).statusCode, 400);

  app.advance(10 * 60);
  const expired = await app.verify({ email, code: second });
  assert.equal(expired.statusCode, 400);
  assert.match(expired.body.message, /expired/);

  assert.equal((await app.resend({ email })).statusCode, 202);
  assert.equal((await app.verify({ email, code: app.lastCode(email) })).statusCode, 201);
});

test('registering again replaces the waiting sign-up and keeps the code already sent', async () => {
  const app = setup(undefined, { users: [] });
  await app.register(registration);
  await app.register({ ...registration, password: 'a newer password' });
  assert.equal(app.pendingRegistrations.length, 1);
  assert.equal(app.emails.length, 1);
  assert.equal((await app.verify({ email, code: app.lastCode(email) })).statusCode, 201);
  assert.equal((await app.passwordLogin({ email, password: 'a newer password' })).statusCode, 200);
});

test('verify and resend need a waiting sign-up and a well-formed code', async () => {
  const app = setup(undefined, { users: [] });
  assert.equal((await app.verify({ email, code: '123456' })).statusCode, 400);
  assert.equal((await app.resend({ email })).statusCode, 400);
  for (const code of [undefined, '', '12345', '1234567', 'abcdef', 123456]) {
    const res = await app.verify({ email, code });
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.fields.code, String(code));
  }
});

test('if Google takes the email after the code was sent, verifying returns 409', async () => {
  const app = setup(undefined, { users: [] });
  await app.register({ ...registration, email: linkedUser.email });
  assert.equal((await app.callback(await app.login())).statusCode, 201);
  const res = await app.verify({ email: linkedUser.email, code: app.lastCode(linkedUser.email) });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.signInMethod, 'google');
  assert.equal(app.users.length, 1);
  assert.equal(app.pendingRegistrations.length, 0);
});

test('a missing OTP secret is a 503 and stores nothing', async () => {
  const app = setup(undefined, { users: [], missingOtpSecret: true });
  const res = await app.register(registration);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'MissingConfigError');
  assert.equal(app.pendingRegistrations.length, 0);
  assert.equal(app.emailCodes.length, 0);
});

test('password login works on several devices at once', async () => {
  const app = setup(undefined, { users: [] });
  const first = (await app.signUp(registration)).body.accessToken;
  const res = await app.passwordLogin({ email: 'COOK@example.com ', password });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.email, email);
  assert.equal(app.sessions.length, 2);
  assert.equal((await app.me(`Bearer ${first}`)).statusCode, 200);
  assert.equal((await app.me(`Bearer ${res.body.accessToken}`)).statusCode, 200);
});

test('wrong passwords and unknown emails get the same 401', async () => {
  const app = setup(undefined, { users: [] });
  await app.signUp(registration);
  const wrong = await app.passwordLogin({ email, password: 'wrong password' });
  const unknown = await app.passwordLogin({ email: 'nobody@example.com', password });
  assert.equal(wrong.statusCode, 401);
  assert.deepEqual(unknown.body, wrong.body);
  assert.equal(app.sessions.length, 1);
  for (const body of [undefined, {}, { email }, { email, password: 'x'.repeat(129) }]) {
    assert.equal((await app.passwordLogin(body)).statusCode, 400);
  }
});

test('a Google account cannot log in with a password', async () => {
  const app = setup();
  const res = await app.passwordLogin({ email: linkedUser.email, password });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.signInMethod, 'google');
  assert.equal(res.body.accessToken, undefined);
  assert.equal(app.sessions.length, 0);
});

test('a disabled account is refused only after the correct password', async () => {
  const app = setup(undefined, { users: [] });
  await app.signUp(registration);
  app.users[0].isActive = false;
  assert.equal((await app.passwordLogin({ email, password: 'wrong password' })).statusCode, 401);
  assert.equal((await app.passwordLogin({ email, password })).statusCode, 403);
  assert.equal(app.sessions.length, 1);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, linkedUser } = require('./app-harness.cjs');

const password = 'correct horse battery';
const registration = { email: 'cook@example.com', password, firstName: 'Sara', lastName: 'Adel' };
const ip = n => `198.51.100.${n}`;

function assertLimited(res) {
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'TooManyRequestsError');
  assert.ok(Number(res.headers['Retry-After']) > 0);
}

async function passwordAccount() {
  const app = setup(undefined, { users: [] });
  assert.equal((await app.signUp(registration)).statusCode, 201);
  return app;
}

test('the sixth failed login for one email is refused, even from other networks and with the right password', async () => {
  const app = await passwordAccount();
  for (let n = 1; n <= 5; n++) {
    const res = await app.passwordLogin({ email: ` COOK@example.com `, password: 'wrong password' }, ip(n));
    assert.equal(res.statusCode, 401);
  }
  assertLimited(await app.passwordLogin({ email: registration.email, password }, ip(6)));
  assert.equal((await app.passwordLogin({ email: 'other@example.com', password }, ip(7))).statusCode, 401);
});

test('successful logins do not count toward the per-email limit', async () => {
  const app = await passwordAccount();
  const attempt = pass => app.passwordLogin({ email: registration.email, password: pass });
  for (let n = 1; n <= 4; n++) assert.equal((await attempt('wrong password')).statusCode, 401);
  assert.equal((await attempt(password)).statusCode, 200);
  assert.equal((await attempt('wrong password')).statusCode, 401);
  assertLimited(await attempt('wrong password'));
});

test('one network gets 20 login attempts per window, whatever the emails', async () => {
  const app = setup(undefined, { users: [] });
  // The IP limit runs before validation, so even invalid bodies count.
  for (let n = 1; n <= 20; n++) {
    assert.equal((await app.passwordLogin({ email: `not-an-email-${n}` })).statusCode, 400);
  }
  assertLimited(await app.passwordLogin({ email: linkedUser.email, password }));
  assert.equal((await app.passwordLogin({ email: 'not-an-email' }, ip(1))).statusCode, 400);
});

test('one network gets 10 sign-ups per hour', async () => {
  const app = setup(undefined, { users: [] });
  for (let n = 1; n <= 10; n++) assert.equal((await app.register({ email: `bad-${n}` })).statusCode, 400);
  assertLimited(await app.register(registration));
  assert.equal(app.pendingRegistrations.length, 0);
  assert.equal((await app.register(registration, ip(1))).statusCode, 202);
});

test('one email gets 5 sign-up attempts per hour, from any network', async () => {
  const app = await passwordAccount();
  for (let n = 1; n <= 4; n++) assert.equal((await app.register(registration, ip(n))).statusCode, 409);
  assertLimited(await app.register(registration, ip(5)));
});

test('one email gets 5 code resends per hour, from any network', async () => {
  const app = setup(undefined, { users: [] });
  await app.register(registration);
  for (let n = 1; n <= 5; n++) {
    app.advance(61);
    assert.equal((await app.resend({ email: registration.email }, ip(n))).statusCode, 202);
  }
  app.advance(61);
  const res = await app.resend({ email: registration.email }, ip(6));
  assertLimited(res);
  assert.match(res.body.message, /code requests for this email/);
});

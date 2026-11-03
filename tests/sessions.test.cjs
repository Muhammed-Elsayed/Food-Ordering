const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { setup, jwtSecret } = require('./app-harness.cjs');

const account = { email: 'cook@example.com', password: 'correct horse battery', firstName: 'Sara', lastName: 'Adel' };

async function signedUp() {
  const app = setup(undefined, { users: [] });
  const res = await app.signUp(account);
  assert.equal(res.statusCode, 201);
  return { app, session: res.body };
}

test('access tokens last 15 minutes and refresh tokens 1 day', async () => {
  const { app, session } = await signedUp();
  const payload = jwt.verify(session.accessToken, jwtSecret, { algorithms: ['HS256'], audience: 'access' });
  assert.equal(payload.exp - payload.iat, 900);
  assert.equal(app.sessions[0].expiresAt - Date.now() > 86_390_000, true);
  assert.match(app.sessions[0].refreshTokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(app.sessions[0].refreshTokenHash, session.refreshToken);
});

test('refresh rotates the refresh token, and the old one stops working', async () => {
  const { app, session } = await signedUp();
  const res = await app.refresh({ refreshToken: session.refreshToken });
  assert.equal(res.statusCode, 200);
  assert.notEqual(res.body.refreshToken, session.refreshToken);
  assert.equal(res.body.user.email, account.email);
  assert.equal(res.body.user.isActive, undefined);
  assert.equal((await app.me(`Bearer ${res.body.accessToken}`)).statusCode, 200);
  assert.equal(app.sessions.length, 1);

  assert.equal((await app.refresh({ refreshToken: session.refreshToken })).statusCode, 401);
  assert.equal((await app.refresh({ refreshToken: res.body.refreshToken })).statusCode, 200);
});

test('each refresh restarts the 1-day lifetime; an unused session expires', async () => {
  const { app, session } = await signedUp();
  app.advance(20 * 60 * 60);
  const refreshed = await app.refresh({ refreshToken: session.refreshToken });
  assert.equal(refreshed.statusCode, 200);

  app.advance(20 * 60 * 60);
  const again = await app.refresh({ refreshToken: refreshed.body.refreshToken });
  assert.equal(again.statusCode, 200);

  app.advance(24 * 60 * 60 + 1);
  assert.equal((await app.refresh({ refreshToken: again.body.refreshToken })).statusCode, 401);
  assert.equal((await app.me(`Bearer ${again.body.accessToken}`)).statusCode, 401);
});

test('refresh is refused for a disabled account and for unknown or malformed tokens', async () => {
  const { app, session } = await signedUp();
  assert.equal((await app.refresh({ refreshToken: 'not-a-real-token' })).statusCode, 401);
  for (const body of [undefined, {}, { refreshToken: '' }, { refreshToken: 123 }, { refreshToken: 'x'.repeat(101) }]) {
    assert.equal((await app.refresh(body)).statusCode, 400);
  }
  app.users[0].isActive = false;
  assert.equal((await app.refresh({ refreshToken: session.refreshToken })).statusCode, 401);
});

test('logout ends every session on every device', async () => {
  const { app, session: phone } = await signedUp();
  const laptop = (await app.passwordLogin({ email: account.email, password: account.password })).body;
  assert.equal(app.sessions.length, 2);

  assert.equal((await app.logout(`Bearer ${phone.accessToken}`)).statusCode, 204);
  assert.equal(app.sessions.length, 0);
  for (const device of [phone, laptop]) {
    assert.equal((await app.me(`Bearer ${device.accessToken}`)).statusCode, 401);
    assert.equal((await app.refresh({ refreshToken: device.refreshToken })).statusCode, 401);
  }
  assert.equal((await app.logout(`Bearer ${laptop.accessToken}`)).statusCode, 401);
  assert.equal((await app.logout()).statusCode, 401);
});

test('logging in clears the user\'s expired sessions', async () => {
  const { app } = await signedUp();
  app.advance(24 * 60 * 60 + 1);
  assert.equal((await app.passwordLogin({ email: account.email, password: account.password })).statusCode, 200);
  assert.equal(app.sessions.length, 1);
});

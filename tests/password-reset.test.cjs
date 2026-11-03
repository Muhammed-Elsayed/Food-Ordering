const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { setup, jwtSecret, linkedUser } = require('./app-harness.cjs');

const account = { email: 'cook@example.com', password: 'correct horse battery', firstName: 'Sara', lastName: 'Adel' };
const email = account.email;
const newPassword = 'a brand new password';
const wrongCode = code => (code === '000000' ? '111111' : '000000');

async function passwordAccount() {
  const app = setup(undefined, { users: [{ ...linkedUser }] });
  const session = (await app.signUp(account)).body;
  assert.equal(typeof session.accessToken, 'string');
  return { app, session };
}

async function resetToken(app) {
  await app.forgotPassword({ email });
  const res = await app.verifyResetCode({ email, code: app.lastCode(email) });
  assert.equal(res.statusCode, 200);
  return res.body.resetToken;
}

test('forgot always answers 202 the same way, and only password accounts get a code', async () => {
  const { app } = await passwordAccount();
  const sent = app.emails.length;
  const answers = [];
  for (const target of [email, linkedUser.email, 'nobody@example.com']) {
    const res = await app.forgotPassword({ email: target });
    assert.equal(res.statusCode, 202);
    answers.push({ ...res.body, email: undefined });
  }
  assert.deepEqual(answers[1], answers[0]);
  assert.deepEqual(answers[2], answers[0]);

  const newEmails = app.emails.slice(sent);
  assert.equal(newEmails.length, 2);
  assert.match(newEmails[0], /To: cook@example.com .*password reset code is \d{6}$/);
  assert.match(newEmails[1], /To: learner@example.com .*Continue with Google/);
  assert.deepEqual(app.emailCodes.map(row => [row.email, row.purpose]), [[email, 'password_reset']]);
});

test('the full reset: code, reset token, new password, every old session ended, logged in', async () => {
  const { app, session: phone } = await passwordAccount();
  const laptop = (await app.passwordLogin({ email, password: account.password })).body;

  await app.forgotPassword({ email: ' COOK@example.com ' });
  const verified = await app.verifyResetCode({ email, code: app.lastCode(email) });
  assert.equal(verified.statusCode, 200);
  assert.equal(verified.body.expiresIn, 600);
  assert.equal(app.emailCodes.length, 0);

  const res = await app.resetPassword({ resetToken: verified.body.resetToken, newPassword });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.email, email);
  assert.equal(res.body.user.emailVerified, true);
  assert.equal(app.sessions.length, 1);
  assert.equal((await app.me(`Bearer ${res.body.accessToken}`)).statusCode, 200);
  for (const device of [phone, laptop]) {
    assert.equal((await app.me(`Bearer ${device.accessToken}`)).statusCode, 401);
    assert.equal((await app.refresh({ refreshToken: device.refreshToken })).statusCode, 401);
  }

  assert.equal((await app.passwordLogin({ email, password: account.password })).statusCode, 401);
  assert.equal((await app.passwordLogin({ email, password: newPassword })).statusCode, 200);
});

test('every failed code check gets the same 400, and five wrong codes end the code', async () => {
  const { app } = await passwordAccount();
  const unknown = await app.verifyResetCode({ email: 'nobody@example.com', code: '123456' });
  assert.equal(unknown.statusCode, 400);

  await app.forgotPassword({ email });
  const code = app.lastCode(email);
  for (let n = 1; n <= 5; n++) {
    const res = await app.verifyResetCode({ email, code: wrongCode(code) });
    assert.deepEqual({ ...res.body }, { ...unknown.body });
  }
  assert.deepEqual({ ...(await app.verifyResetCode({ email, code })).body }, { ...unknown.body });
});

test('reset codes expire after 10 minutes; asking again within 60 seconds sends nothing', async () => {
  const { app } = await passwordAccount();
  await app.forgotPassword({ email });
  const sent = app.emails.length;
  assert.equal((await app.forgotPassword({ email })).statusCode, 202);
  assert.equal(app.emails.length, sent);

  app.advance(10 * 60 + 1);
  assert.equal((await app.verifyResetCode({ email, code: app.lastCode(email) })).statusCode, 400);
  assert.equal((await app.forgotPassword({ email })).statusCode, 202);
  assert.equal(app.emails.length, sent + 1);
  assert.equal((await app.verifyResetCode({ email, code: app.lastCode(email) })).statusCode, 200);
});

test('a reset token works once, and only as a reset token', async () => {
  const { app, session } = await passwordAccount();
  const token = await resetToken(app);
  assert.equal((await app.me(`Bearer ${token}`)).statusCode, 401);
  assert.equal((await app.resetPassword({ resetToken: session.accessToken, newPassword })).statusCode, 400);

  assert.equal((await app.resetPassword({ resetToken: token, newPassword })).statusCode, 200);
  const again = await app.resetPassword({ resetToken: token, newPassword: 'yet another password' });
  assert.equal(again.statusCode, 400);
  assert.match(again.body.message, /expired/);

  const { sub, pwf } = jwt.decode(token);
  for (const forged of [
    jwt.sign({ sub, pwf }, jwtSecret, { audience: 'password-reset', expiresIn: -10 }),
    jwt.sign({ sub, pwf }, 'another-secret', { audience: 'password-reset' }),
    jwt.sign({ sub }, jwtSecret, { audience: 'password-reset' }),
    'not-a-token',
  ]) {
    assert.equal((await app.resetPassword({ resetToken: forged, newPassword })).statusCode, 400);
  }
});

test('a sign-up code is not a reset code', async () => {
  const app = setup(undefined, { users: [] });
  await app.register(account);
  const signUpCode = app.lastCode(email);
  // The account now exists (e.g. created on another device) and asks for a reset.
  await app.verify({ email, code: signUpCode });
  await app.forgotPassword({ email });
  const resetCode = app.lastCode(email);
  if (resetCode !== signUpCode) {
    assert.equal((await app.verifyResetCode({ email, code: signUpCode })).statusCode, 400);
  }
  assert.equal((await app.verifyResetCode({ email, code: resetCode })).statusCode, 200);
});

test('disabled accounts get no code, and a token stops working if the account is disabled', async () => {
  const { app } = await passwordAccount();
  const token = await resetToken(app);
  app.users.find(user => user.email === email).isActive = false;
  assert.equal((await app.resetPassword({ resetToken: token, newPassword })).statusCode, 400);

  const sent = app.emails.length;
  app.advance(61);
  assert.equal((await app.forgotPassword({ email })).statusCode, 202);
  assert.equal(app.emails.length, sent);
});

test('reset validates its body', async () => {
  const { app } = await passwordAccount();
  const res = await app.resetPassword({ resetToken: '', newPassword: 'short' });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(Object.keys(res.body.fields).sort(), ['newPassword', 'resetToken']);
  assert.equal((await app.verifyResetCode({ email, code: '12345' })).body.fields.code !== undefined, true);
});

test('one email gets 5 reset requests per hour', async () => {
  const { app } = await passwordAccount();
  for (let n = 1; n <= 5; n++) assert.equal((await app.forgotPassword({ email }, `198.51.100.${n}`)).statusCode, 202);
  const res = await app.forgotPassword({ email }, '198.51.100.6');
  assert.equal(res.statusCode, 429);
  assert.match(res.body.message, /password reset requests for this email/);
});

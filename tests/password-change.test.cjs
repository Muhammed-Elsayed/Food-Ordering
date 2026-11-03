const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, linkedUser } = require('./app-harness.cjs');

const account = { email: 'cook@example.com', password: 'correct horse battery', firstName: 'Sara', lastName: 'Adel' };
const newPassword = 'a brand new password';
const bearer = session => `Bearer ${session.accessToken}`;

async function twoDevices() {
  const app = setup(undefined, { users: [] });
  const phone = (await app.signUp(account)).body;
  const laptop = (await app.passwordLogin({ email: account.email, password: account.password })).body;
  return { app, phone, laptop };
}

test('changing the password keeps this device, ends the others, and emails the owner', async () => {
  const { app, phone, laptop } = await twoDevices();
  const res = await app.changePassword({ currentPassword: account.password, newPassword }, bearer(phone));
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, undefined);

  assert.equal((await app.me(bearer(phone))).statusCode, 200);
  assert.equal((await app.refresh({ refreshToken: phone.refreshToken })).statusCode, 200);
  assert.equal((await app.me(bearer(laptop))).statusCode, 401);
  assert.equal((await app.refresh({ refreshToken: laptop.refreshToken })).statusCode, 401);
  assert.equal(app.sessions.length, 1);

  assert.match(app.emails.at(-1), /To: cook@example.com .*password was changed/);
  assert.equal((await app.passwordLogin({ email: account.email, password: account.password })).statusCode, 401);
  assert.equal((await app.passwordLogin({ email: account.email, password: newPassword })).statusCode, 200);
});

test('a wrong current password is a 400 on the field, not a 401, and changes nothing', async () => {
  const { app, phone } = await twoDevices();
  const hash = app.users[0].passwordHash;
  const res = await app.changePassword({ currentPassword: 'not my password', newPassword }, bearer(phone));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.fields.currentPassword, 'Your current password is wrong.');
  assert.equal(app.users[0].passwordHash, hash);
  assert.equal(app.sessions.length, 2);
});

test('a Google account has no password to change', async () => {
  const app = setup();
  const session = (await app.callback(await app.login())).body;
  const res = await app.changePassword({ currentPassword: 'anything at all', newPassword }, bearer(session));
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.signInMethod, 'google');
  assert.equal(app.users.find(user => user.id === linkedUser.id).passwordHash, null);
});

test('change password needs a valid token and a valid body', async () => {
  const { app, phone } = await twoDevices();
  assert.equal((await app.changePassword({ currentPassword: account.password, newPassword })).statusCode, 401);
  const res = await app.changePassword({ currentPassword: '', newPassword: 'short' }, bearer(phone));
  assert.equal(res.statusCode, 400);
  assert.deepEqual(Object.keys(res.body.fields).sort(), ['currentPassword', 'newPassword']);
});

test('a password reset token issued before the change stops working', async () => {
  const { app, phone } = await twoDevices();
  await app.forgotPassword({ email: account.email });
  const { resetToken } = (await app.verifyResetCode({ email: account.email, code: app.lastCode(account.email) })).body;
  await app.changePassword({ currentPassword: account.password, newPassword }, bearer(phone));
  assert.equal((await app.resetPassword({ resetToken, newPassword: 'attacker password' })).statusCode, 400);
});

test('five wrong current passwords lock changes for that user, whatever the network', async () => {
  const { app, phone } = await twoDevices();
  for (let n = 1; n <= 5; n++) {
    const res = await app.changePassword({ currentPassword: 'wrong guess', newPassword }, bearer(phone), `198.51.100.${n}`);
    assert.equal(res.statusCode, 400);
  }
  const res = await app.changePassword({ currentPassword: account.password, newPassword }, bearer(phone), '198.51.100.6');
  assert.equal(res.statusCode, 429);
  assert.match(res.body.message, /wrong current passwords/);
});

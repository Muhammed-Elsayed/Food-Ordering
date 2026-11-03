const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { setup, scope, jwtSecret, linkedUser, publicUser } = require('./app-harness.cjs');

test('logs in the linked user with our access token and keeps Google tokens private', async () => {
  const app = setup();
  const flow = await app.login();
  const authorizationUrl = new URL(flow.url);
  assert.equal(authorizationUrl.searchParams.get('scope'), scope);
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  const nonce = authorizationUrl.searchParams.get('nonce');
  assert.match(nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(nonce, flow.state);
  const anotherFlow = await app.login();
  assert.notEqual(new URL(anotherFlow.url).searchParams.get('nonce'), nonce);
  assert.equal(flow.cookieConfig.httpOnly, true);
  assert.equal(flow.cookieConfig.sameSite, 'lax');
  const res = await app.callback(flow);
  assert.equal(res.statusCode, 200);
  assert.equal(res.cleared, true);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(res.body.tokenType, 'Bearer');
  assert.equal(res.body.expiresIn, 900);
  assert.deepEqual(res.body.user, publicUser);
  const payload = jwt.verify(res.body.accessToken, jwtSecret, { algorithms: ['HS256'], audience: 'access' });
  assert.equal(payload.sub, linkedUser.id);
  assert.equal(app.sessions.length, 1);
  assert.equal(payload.sid, app.sessions[0].id);
  assert.equal(payload.exp - payload.iat, 900);
  assert.equal(app.verificationRequests.length, 1);
  assert.equal(app.verificationRequests[0].audience, 'test-client');
  assert.equal(JSON.stringify(res.body).includes(app.verificationRequests[0].idToken), false);
  assert.doesNotMatch(JSON.stringify(res.body), /private-token|private-id-token|test-secret|test-code|google-user-123/);
  const request = app.requests[0];
  assert.equal(request.url, 'https://oauth2.googleapis.com/token');
  assert.equal(request.method, 'POST');
  assert.equal(request.data.get('grant_type'), 'authorization_code');
  assert.equal(request.data.get('code'), 'test-code');
  assert.equal(request.data.get('client_id'), 'test-client');
  assert.equal(request.data.get('client_secret'), 'test-secret');
  assert.equal(request.data.get('redirect_uri'), 'http://localhost:3000/auth/google/callback');
  assert.equal(request.data.has('state'), false);
  assert.equal(createHash('sha256').update(request.data.get('code_verifier')).digest('base64url'), flow.challenge);
  assert.equal((await app.callback(flow)).statusCode, 400);
  assert.equal(app.requests.length, 1);
});

test('wrong state, wrong browser, missing cookie, and expiry prevent exchange', async () => {
  const app = setup();
  const flow = await app.login();
  assert.equal((await app.callback(flow, { state: 'unknown' })).statusCode, 400);
  assert.equal((await app.callback(flow, { state: ['duplicate'] })).statusCode, 400);
  assert.equal((await app.callback({ ...flow, cookie: 'oauth_browser=wrong' })).statusCode, 400);
  assert.equal((await app.callback({ ...flow, cookie: '' })).statusCode, 400);
  app.expire();
  assert.equal((await app.callback(flow)).statusCode, 400);
  assert.equal(app.requests.length, 0);
});

test('denial and missing code consume attempts without exchanging', async () => {
  const app = setup();
  const denied = await app.login();
  assert.equal((await app.callback(denied, { error: 'access_denied' })).statusCode, 400);
  assert.equal((await app.callback(denied)).statusCode, 400);
  assert.equal((await app.callback(await app.login(), { code: '' })).statusCode, 400);
  assert.equal(app.requests.length, 0);
});

test('missing client secret blocks Google authorization but not /auth/me', async () => {
  const app = setup(undefined, { missingSecret: true });
  assert.equal((await app.login()).statusCode, 503);
  assert.equal(app.requests.length, 0);
  assert.equal((await app.me()).statusCode, 401);
});

test('provider rejection and network failures return safe errors', async () => {
  for (const options of [{ rejected: true }, { networkError: true }]) {
    const app = setup(undefined, options);
    const flow = await app.login();
    const res = await app.callback(flow);
    assert.equal(res.statusCode, 502);
    assert.doesNotMatch(JSON.stringify(res.body), /private|test-secret/);
    assert.equal((await app.callback(flow)).statusCode, 400);
    assert.equal(app.requests.length, 1);
  }
});

test('invalid token responses are rejected', async () => {
  for (const reply of [null, {}, { access_token: '', token_type: 'Bearer', expires_in: 3600, scope },
    { access_token: 'private-token', token_type: 'Bearer', expires_in: -1, scope },
    { access_token: 'private-token', token_type: 'wrong', expires_in: 3600, scope }]) {
    const app = setup(reply);
    assert.equal((await app.callback(await app.login())).statusCode, 502);
  }
});

test('missing or empty ID tokens fail before identity verification', async () => {
  for (const id_token of [undefined, '', 123]) {
    const app = setup({ access_token: 'private-token', token_type: 'Bearer', expires_in: 3600, scope, id_token });
    const flow = await app.login();
    assert.equal((await app.callback(flow)).statusCode, 502);
    assert.equal((await app.callback(flow)).statusCode, 400);
    assert.equal(app.requests.length, 1);
  }
});

test('rejects invalid signatures, issuer, audience, expiry, nonce, and subject', async () => {
  const expired = Math.floor(Date.now() / 1000) - 600;
  for (const options of [
    { invalidSignature: true },
    { claims: { iss: 'https://attacker.example' } },
    { claims: { aud: 'another-client' } },
    { claims: { iat: expired - 3600, exp: expired } },
    { claims: { nonce: 'wrong' } },
    { claims: { nonce: undefined } },
    { claims: { sub: '' } },
    { claims: { sub: undefined } },
  ]) {
    const app = setup(undefined, options);
    const flow = await app.login();
    const res = await app.callback(flow);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.identity, undefined);
    assert.doesNotMatch(JSON.stringify(res.body), /google-user-123|learner@example.com|private-token/);
    assert.equal((await app.callback(flow)).statusCode, 400);
    assert.equal(app.requests.length, 1);
  }
});

test('a linked user logs in by Google sub even without email and profile claims', async () => {
  const app = setup(undefined, { claims: { email: undefined, email_verified: undefined, name: undefined } });
  const res = await app.callback(await app.login());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.user, publicUser);
  assert.equal(typeof res.body.accessToken, 'string');
});

test('a first Google login creates the account and logs it in', async () => {
  const app = setup(undefined, { users: [], claims: { email: ' Learner@Example.com ' } });
  const res = await app.callback(await app.login());
  assert.equal(res.statusCode, 201);
  assert.equal(app.users.length, 1);
  const [created] = app.users;
  assert.equal(created.googleSub, 'google-user-123');
  assert.equal(created.email, 'learner@example.com');
  assert.equal(created.emailVerified, true);
  assert.equal(created.passwordHash, null);
  assert.deepEqual(res.body.user, { ...publicUser, id: created.id });
  const payload = jwt.verify(res.body.accessToken, jwtSecret, { algorithms: ['HS256'], audience: 'access' });
  assert.equal(payload.sub, created.id);
  assert.equal(payload.sid, app.sessions[0].id);
  assert.equal((await app.me(`Bearer ${res.body.accessToken}`)).statusCode, 200);

  const again = await app.callback(await app.login());
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.user.id, created.id);
  assert.equal(app.users.length, 1);
});

test('missing or blank Google names are stored as null', async () => {
  const app = setup(undefined, { users: [], claims: { given_name: '  ', family_name: undefined } });
  const res = await app.callback(await app.login());
  assert.equal(res.statusCode, 201);
  assert.equal(app.users[0].firstName, null);
  assert.equal(app.users[0].lastName, null);
});

test('an unverified or missing Google email does not create an account', async () => {
  for (const claims of [{ email_verified: false }, { email_verified: undefined }, { email: undefined }, { email: '' }]) {
    const app = setup(undefined, { users: [], claims });
    const res = await app.callback(await app.login());
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.accessToken, undefined);
    assert.equal(app.users.length, 0);
  }
});

test('an email owned by another account is not linked automatically', async () => {
  const app = setup(undefined, { users: [{ ...linkedUser, googleSub: null, passwordHash: 'hash' }] });
  const res = await app.callback(await app.login());
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'ConflictError');
  assert.equal(res.body.signInMethod, 'password');
  assert.equal(res.body.accessToken, undefined);
  assert.equal(app.users.length, 1);
  assert.equal(app.users[0].googleSub, null);
  assert.equal(app.sessions.length, 0);
});

test('a parallel first login logs into the account the other request created', async () => {
  const app = setup(undefined, { users: [], parallelFirstLogin: true });
  const res = await app.callback(await app.login());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.id, '22222222-2222-4222-8222-222222222222');
  assert.equal(app.users.length, 1);
});

test('a disabled linked user is not logged in', async () => {
  const app = setup(undefined, { users: [{ ...linkedUser, isActive: false }] });
  const res = await app.callback(await app.login());
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.accessToken, undefined);
  assert.equal(app.sessions.length, 0);
});

test('database and JWT configuration failures are not reported as Google failures', async () => {
  const databaseApp = setup(undefined, { databaseError: true });
  const databaseRes = await databaseApp.callback(await databaseApp.login());
  assert.equal(databaseRes.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(databaseRes.body), /private/);

  const secretApp = setup(undefined, { missingJwtSecret: true });
  const secretRes = await secretApp.callback(await secretApp.login());
  assert.equal(secretRes.statusCode, 503);
  assert.equal(secretRes.body.error, 'MissingConfigError');
  assert.equal(secretApp.sessions.length, 0);

  // Signing happens before a first-login insert, so nothing is created.
  const newUserApp = setup(undefined, { users: [], missingJwtSecret: true });
  assert.equal((await newUserApp.callback(await newUserApp.login())).statusCode, 503);
  assert.equal(newUserApp.users.length, 0);
});

test('/auth/me works for every live session until the account is disabled', async () => {
  const app = setup();
  const first = (await app.callback(await app.login())).body.accessToken;
  const res = await app.me(`Bearer ${first}`);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.user, publicUser);

  const second = (await app.callback(await app.login())).body.accessToken;
  assert.notEqual(second, first);
  assert.equal((await app.me(`Bearer ${first}`)).statusCode, 200);
  assert.equal((await app.me(`Bearer ${second}`)).statusCode, 200);

  app.users[0].isActive = false;
  assert.equal((await app.me(`Bearer ${first}`)).statusCode, 401);
  assert.equal((await app.me(`Bearer ${second}`)).statusCode, 401);
});

test('/auth/me rejects missing, malformed, forged, expired, and wrong-purpose tokens', async () => {
  const app = setup();
  const { accessToken } = (await app.callback(await app.login())).body;
  const claims = { sub: linkedUser.id, sid: app.sessions[0].id };
  const expired = { ...claims, exp: Math.floor(Date.now() / 1000) - 10 };
  for (const authorization of [
    undefined, '', accessToken, `Token ${accessToken}`, 'Bearer not-a-jwt',
    `Bearer ${jwt.sign(claims, 'another-secret', { audience: 'access' })}`,
    `Bearer ${jwt.sign(claims, jwtSecret, { audience: 'google-signup' })}`,
    `Bearer ${jwt.sign(claims, jwtSecret)}`,
    `Bearer ${jwt.sign(claims, jwtSecret, { audience: 'access', algorithm: 'HS512' })}`,
    `Bearer ${jwt.sign(expired, jwtSecret, { audience: 'access' })}`,
    `Bearer ${jwt.sign({ sub: linkedUser.id }, jwtSecret, { audience: 'access' })}`,
    `Bearer ${jwt.sign({ ...claims, sid: '33333333-3333-4333-8333-333333333333' }, jwtSecret, { audience: 'access' })}`,
    `Bearer ${jwt.sign({ ...claims, sub: '22222222-2222-4222-8222-222222222222' }, jwtSecret, { audience: 'access' })}`,
  ]) {
    const res = await app.me(authorization);
    assert.equal(res.statusCode, 401, String(authorization));
    assert.equal(res.body.user, undefined);
  }
  assert.equal((await app.me(`Bearer ${accessToken}`)).statusCode, 200);
});

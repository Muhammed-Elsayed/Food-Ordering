// Loads the compiled app (dist/) with a fake Express, mocked Google responses, and an
// in-memory database. No credentials, network, database, or ports are needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const { google, Auth } = require('googleapis');

const scope = 'openid email profile';
// Test keys replace Google's public-key lookup; the real SDK verifies the ID token.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const certificates = { 'test-key': publicKey.export({ type: 'spki', format: 'pem' }) };
const jwtSecret = 'test-jwt-secret';
// The user linked to the Google account in the mocked ID token.
const linkedUser = {
  id: '11111111-1111-4111-8111-111111111111', email: 'learner@example.com', firstName: 'Learner', lastName: 'Tester',
  phone: null, phoneVerified: false, emailVerified: true, isActive: true, googleSub: 'google-user-123', passwordHash: null,
};
const publicFields = ['id', 'email', 'firstName', 'lastName', 'phone', 'phoneVerified', 'emailVerified'];
const publicUser = Object.fromEntries(publicFields.map(key => [key, linkedUser[key]]));

// Just enough of Prisma for the queries the app makes, with the same unique indexes as
// PostgreSQL (violations fail with Prisma's P2002).
function createDatabase(options) {
  const tables = {
    user: (options.users ?? [linkedUser]).map(user => ({ ...user })),
    session: [],
    pendingRegistration: [],
    emailCode: [],
  };
  const uniqueKeys = {
    user: [['id'], ['email'], ['googleSub']], session: [['id'], ['refreshTokenHash']],
    pendingRegistration: [['email']], emailCode: [['email', 'purpose']],
  };
  const defaults = {
    user: () => ({ isActive: true, googleSub: null, passwordHash: null, phone: null, phoneVerified: false }),
    session: () => ({ createdAt: new Date() }),
    pendingRegistration: () => ({}),
    emailCode: () => ({ attempts: 0 }),
  };
  const relations = { session: { user: row => tables.user.find(user => user.id === row.userId) } };
  const operators = {
    gt: (a, b) => +a > +b, gte: (a, b) => +a >= +b, lt: (a, b) => +a < +b, lte: (a, b) => +a <= +b, not: (a, b) => a !== b,
  };

  const isObject = condition => condition !== null && typeof condition === 'object' && !(condition instanceof Date);
  const isOperator = condition => isObject(condition) && Object.keys(condition).every(key => key in operators);
  const compare = (value, condition) => isOperator(condition)
    ? Object.entries(condition).every(([op, expected]) => operators[op](value, expected))
    : value instanceof Date ? +value === +condition : value === condition;
  // Relation filters (session.user) and compound keys (emailCode.email_purpose) hold nested objects.
  const matches = (table, where = {}) => row => row !== undefined && Object.entries(where).every(([key, condition]) =>
    relations[table]?.[key] ? matches('user', condition)(relations[table][key](row))
      : isObject(condition) && !isOperator(condition) ? matches(table, condition)(row)
        : compare(row[key], condition));
  const pick = (table, row, select) => {
    if (!row) return null;
    if (!select) return { ...row };
    return Object.fromEntries(Object.entries(select).map(([key, value]) =>
      [key, value.select ? pick('user', relations[table][key](row), value.select) : row[key]]));
  };
  const apply = (row, data) => {
    for (const [key, value] of Object.entries(data)) {
      row[key] = value !== null && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
    }
  };
  const checkUnique = (table, row) => {
    const clash = tables[table].some(other => other !== row && uniqueKeys[table].some(keys =>
      keys.every(key => row[key] != null && other[key] === row[key])));
    if (clash) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  };
  const insert = (table, data) => {
    const row = { ...defaults[table](), ...data };
    checkUnique(table, row);
    tables[table].push(row);
    return row;
  };

  const delegate = table => ({
    async findUnique({ where, select }) {
      if (options.databaseError) throw new Error('private database details');
      return pick(table, tables[table].find(matches(table, where)), select);
    },
    async findFirst({ where, select }) { return pick(table, tables[table].find(matches(table, where)), select); },
    async create({ data, select }) {
      if (table === 'user' && options.parallelFirstLogin) {
        tables.user.push({ ...linkedUser, id: '22222222-2222-4222-8222-222222222222' });
      }
      const { sessions, ...fields } = data;
      const row = insert(table, fields);
      if (sessions) insert('session', { ...sessions.create, userId: row.id });
      return pick(table, row, select);
    },
    async update({ where, data }) {
      const row = tables[table].find(matches(table, where));
      apply(row, data);
      return { ...row };
    },
    async updateMany({ where, data }) {
      const rows = tables[table].filter(matches(table, where));
      for (const row of rows) apply(row, data);
      return { count: rows.length };
    },
    async upsert({ where, create, update }) {
      const row = tables[table].find(matches(table, where));
      if (!row) return { ...insert(table, create) };
      apply(row, update);
      return { ...row };
    },
    async deleteMany({ where }) {
      const before = tables[table].length;
      tables[table] = tables[table].filter(row => !matches(table, where)(row));
      return { count: before - tables[table].length };
    },
  });

  const client = {
    user: delegate('user'), session: delegate('session'),
    pendingRegistration: delegate('pendingRegistration'), emailCode: delegate('emailCode'),
    // Runs the callback against the same tables; the fake does not roll back.
    async $transaction(callback) { return callback(client); },
  };
  const database = { async connect() {}, async disconnect() {}, client };
  return { database, tables };
}

function setup(reply = { access_token: 'private-token', id_token: 'private-id-token', token_type: 'Bearer', expires_in: 3600, scope }, options = {}) {
  const routes = new Map();
  const requests = [];
  const verificationRequests = [];
  const nonces = new Map();
  const emails = [];
  let errorHandler;
  const appMiddleware = [];
  const app = {
    use(path, router) {
      // Like Express: a four-argument function is the error handler; others run on every request.
      if (typeof path === 'function') {
        if (path.length === 4) errorHandler = path; else appMiddleware.push(path);
        return;
      }
      if (typeof path !== 'string') [path, router] = ['', path];
      for (const [route, handlers] of router.routes) routes.set(path + route, handlers);
    },
    listen() {},
  };
  const { database, tables } = createDatabase(options);
  class MockOAuth2 extends google.auth.OAuth2 {
    constructor(config) {
      super(config);
      assert.equal(this.transporter.defaults.timeout, 10_000);
      assert.equal(this.transporter.defaults.maxRedirects, 0);
      this.transporter.request = async (request) => {
        requests.push(request);
        if (options.networkError || options.rejected) throw new Error('private provider details');
        const data = reply === null ? null : { ...reply };
        if (data?.id_token === 'private-id-token') {
          const challenge = createHash('sha256').update(request.data.get('code_verifier')).digest('base64url');
          const now = Math.floor(Date.now() / 1000);
          const payload = {
            iss: 'https://accounts.google.com', aud: 'test-client', iat: now, exp: now + 3600,
            sub: 'google-user-123', nonce: nonces.get(challenge),
            email: 'learner@example.com', email_verified: true, name: 'Learner Tester',
            given_name: 'Learner', family_name: 'Tester',
            ...options.claims,
          };
          const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
          const content = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode(payload)}`;
          const signature = sign('RSA-SHA256', Buffer.from(content), privateKey);
          if (options.invalidSignature) signature[0] ^= 1;
          data.id_token = `${content}.${signature.toString('base64url')}`;
        }
        return { data };
      };
    }
    generateAuthUrl(config) {
      nonces.set(config.code_challenge, config.nonce);
      return super.generateAuthUrl(config);
    }
    async getFederatedSignonCertsAsync() {
      return { certs: certificates, format: 'PEM' };
    }
    async verifyIdToken(config) {
      verificationRequests.push(config);
      return super.verifyIdToken(config);
    }
  }
  const express = () => app;
  express.Router = () => ({
    routes: new Map(),
    get(path, ...handlers) { this.routes.set(path, handlers); },
    post(path, ...handlers) { this.routes.set(path, handlers); },
    use(prefix, child) { for (const [route, handlers] of child.routes) this.routes.set(prefix + route, handlers); },
  });
  // Tests pass req.body directly, as if express.json() had parsed it.
  express.json = () => (_req, _res, next) => next();
  // The app's clock; advance() moves it forward. Rate limits and JWT expiry use the real clock.
  let now = Date.now();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = {
    URL, URLSearchParams, AbortSignal, Buffer, Date: Clock,
    // The console email sender prints codes with console.log.
    console: { error() {}, log(message) { emails.push(message); } },
    process: { once() {}, env: {
      OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: options.missingSecret ? '' : 'test-secret',
      OAUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
      JWT_SECRET_KEY: options.missingJwtSecret ? '' : jwtSecret,
      OTP_SECRET_KEY: options.missingOtpSecret ? '' : 'test-otp-secret',
    } },
    setInterval: () => ({ unref() {} }),
  };
  // Each compiled module runs once in its own context; relative imports resolve inside dist/.
  const dist = path.resolve('dist');
  const packages = {
    express, googleapis: { google: { auth: { OAuth2: MockOAuth2 } }, Auth },
    'node:fs': { existsSync: () => false },
  };
  const modules = new Map([[path.join(dist, 'db/index.js'), { database }]]);
  function load(file) {
    if (!modules.has(file)) {
      const moduleContext = {
        ...context, exports: {},
        require: name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : packages[name] ?? require(name),
      };
      modules.set(file, moduleContext.exports);
      vm.runInNewContext(fs.readFileSync(file, 'utf8'), moduleContext);
    }
    return modules.get(file);
  }
  load(path.join(dist, 'index.js'));
  function response() {
    const listeners = {};
    return {
      statusCode: 200, headers: {}, locals: {},
      set(key, value) { if (typeof key === 'object') Object.assign(this.headers, key); else this.headers[key] = value; return this; },
      setHeader(key, value) { this.headers[key] = value; },
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; },
      end() {},
      cookie(key, value, config) { this.cookieValue = `${key}=${value}`; this.cookieConfig = config; },
      clearCookie() { this.cleared = true; },
      redirect(url) { this.url = url; },
      // express-rate-limit waits for 'finish' to decide whether a request succeeded.
      once(event, listener) { (listeners[event] ??= []).push(listener); },
      emit(event) { for (const listener of listeners[event] ?? []) listener(); },
    };
  }
  // Like Express 5: run handlers in order and send thrown or next(error) errors to the error handler.
  async function dispatch(path, req, res) {
    req = { headers: {}, ip: '203.0.113.10', app: { get() {} }, ...req };
    try {
      for (const handler of [...appMiddleware, ...routes.get(path)]) {
        let proceed = false;
        let failure;
        await handler(req, res, error => { if (error) failure = error; else proceed = true; });
        if (failure) throw failure;
        if (!proceed) break;
      }
    } catch (error) {
      errorHandler(error, req, res, () => {});
    }
    res.emit('finish');
    await new Promise(resolve => setImmediate(resolve));
  }
  async function login() {
    const res = response(); await dispatch('/auth/google', {}, res);
    if (!res.url) return res;
    const url = new URL(res.url);
    return { ...res, state: url.searchParams.get('state'), challenge: url.searchParams.get('code_challenge'), cookie: res.cookieValue };
  }
  async function callback(flow, query = {}) {
    const res = response();
    await dispatch('/auth/google/callback', { query: { state: flow.state, code: 'test-code', ...query }, headers: { cookie: flow.cookie } }, res);
    return res;
  }
  async function send(path, { body, ip, authorization } = {}) {
    const res = response();
    const headers = authorization === undefined ? {} : { authorization };
    await dispatch(path, { body, headers, ...(ip && { ip }) }, res);
    return res;
  }
  const lastCode = email => {
    const line = emails.findLast(message => message.includes(`To: ${email} `));
    return line?.match(/code is (\d{6})$/)?.[1];
  };
  const register = (body, ip) => send('/auth/register', { body, ip });
  const verify = (body, ip) => send('/auth/register/verify', { body, ip });
  return {
    login, callback, emails, lastCode, register, verify, requests, verificationRequests,
    get users() { return tables.user; },
    get sessions() { return tables.session; },
    get pendingRegistrations() { return tables.pendingRegistration; },
    get emailCodes() { return tables.emailCode; },
    advance(seconds) { now += seconds * 1000; },
    expire() { now += 10 * 60 * 1000; },
    get: path => send(path),
    me: authorization => send('/auth/me', { authorization }),
    resend: (body, ip) => send('/auth/register/resend', { body, ip }),
    passwordLogin: (body, ip) => send('/auth/login', { body, ip }),
    refresh: body => send('/auth/refresh', { body }),
    forgotPassword: (body, ip) => send('/auth/password/forgot', { body, ip }),
    verifyResetCode: (body, ip) => send('/auth/password/verify-code', { body, ip }),
    resetPassword: (body, ip) => send('/auth/password/reset', { body, ip }),
    changePassword: (body, authorization, ip) => send('/auth/password/change', { body, authorization, ip }),
    logout: authorization => send('/auth/logout', { authorization }),
    // Register, then verify with the code from the "email".
    async signUp(body) {
      const pending = await register(body);
      if (pending.statusCode !== 202) return pending;
      return verify({ email: body.email, code: lastCode(pending.body.email) });
    },
  };
}

module.exports = { setup, scope, jwtSecret, linkedUser, publicUser };

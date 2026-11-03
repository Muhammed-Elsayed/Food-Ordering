const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./app-harness.cjs');

test('health check answers without a token and allows any origin', async () => {
  const res = await setup().get('/health');
  assert.equal(res.statusCode, 200);
  assert.deepEqual({ ...res.body }, { status: 'ok' }); // copied out of the app's vm context
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
});

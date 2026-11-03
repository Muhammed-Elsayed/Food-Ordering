const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// Runs against the local database (npm run test:db) and rolls back everything it writes.
test('PostgreSQL constraints for users, sessions, pending registrations, and email codes', {
  skip: process.env.RUN_DB_TESTS !== '1',
}, async () => {
  const { database } = require('../dist/db/index.js');
  const marker = new Error('Rollback test data');
  try {
    await database.connect();
    await assert.rejects(database.client.$transaction(async (tx) => {
      const suffix = randomUUID();
      async function rejected(operation) {
        await tx.$executeRawUnsafe('SAVEPOINT constraint_check');
        await assert.rejects(operation);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT constraint_check');
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT constraint_check');
      }

      const user = await tx.user.create({ data: {
        email: `google-${suffix}@example.invalid`, googleSub: `test-${suffix}`, firstName: 'Test', lastName: 'Customer',
      } });
      assert.equal(user.passwordHash, null);
      assert.equal(user.isActive, true);
      assert.match(user.id, /^[0-9a-f-]{36}$/);
      const passwordUser = await tx.user.create({ data: {
        email: `password-${suffix}@example.invalid`, passwordHash: 'test-password-hash',
      } });
      assert.equal(passwordUser.googleSub, null);

      // Users: a login method, unique and normalized emails, unique Google accounts.
      await rejected(() => tx.user.create({ data: { email: `empty-${suffix}@example.invalid` } }));
      await rejected(() => tx.user.create({ data: { email: user.email, googleSub: `other-${suffix}` } }));
      await rejected(() => tx.user.create({ data: { email: `other-${suffix}@example.invalid`, googleSub: user.googleSub } }));
      await rejected(() => tx.user.create({ data: { email: `UPPER-${suffix}@example.invalid`, passwordHash: 'test-hash' } }));

      // Phone: E.164 when present, verifiable only when set, unique only once verified.
      await rejected(() => tx.user.update({ where: { id: user.id }, data: { phone: '01001234567' } }));
      await rejected(() => tx.user.update({ where: { id: user.id }, data: { phoneVerified: true } }));
      const phone = `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
      await tx.user.update({ where: { id: passwordUser.id }, data: { phone } });
      await tx.user.update({ where: { id: user.id }, data: { phone, phoneVerified: true } });
      await rejected(() => tx.user.update({ where: { id: passwordUser.id }, data: { phoneVerified: true } }));

      // Sessions: hashed refresh tokens only, unique, conditional rotation, deleted with the user.
      const expiresAt = new Date(Date.now() + 60_000);
      const session = await tx.session.create({ data: {
        id: randomUUID(), userId: user.id, refreshTokenHash: 'a'.repeat(64), expiresAt,
      } });
      await rejected(() => tx.session.create({ data: {
        id: randomUUID(), userId: user.id, refreshTokenHash: 'raw-token', expiresAt,
      } }));
      await rejected(() => tx.session.create({ data: {
        id: randomUUID(), userId: passwordUser.id, refreshTokenHash: 'a'.repeat(64), expiresAt,
      } }));
      await rejected(() => tx.session.create({ data: {
        id: randomUUID(), userId: randomUUID(), refreshTokenHash: 'c'.repeat(64), expiresAt,
      } }));
      const rotation = {
        where: { id: session.id, refreshTokenHash: 'a'.repeat(64), expiresAt: { gt: new Date() } },
        data: { refreshTokenHash: 'b'.repeat(64), expiresAt },
      };
      assert.equal((await tx.session.updateMany(rotation)).count, 1);
      assert.equal((await tx.session.updateMany(rotation)).count, 0);
      await tx.user.delete({ where: { id: user.id } });
      assert.equal(await tx.session.count({ where: { id: session.id } }), 0);

      // Pending registrations: normalized email, real names, E.164 phone.
      const pending = {
        email: `pending-${suffix}@example.invalid`, passwordHash: 'test-password-hash', firstName: 'Sara', lastName: 'Adel',
      };
      await tx.pendingRegistration.create({ data: pending });
      const another = { ...pending, email: `another-${suffix}@example.invalid` };
      await rejected(() => tx.pendingRegistration.create({ data: pending }));
      await rejected(() => tx.pendingRegistration.create({ data: { ...another, email: another.email.toUpperCase() } }));
      await rejected(() => tx.pendingRegistration.create({ data: { ...another, firstName: '  ' } }));
      await rejected(() => tx.pendingRegistration.create({ data: { ...another, phone: '01001234567' } }));

      // Email codes: one per email and purpose, normalized email, hashed code, attempts >= 0.
      const code = { email: pending.email, purpose: 'register', codeHash: 'd'.repeat(64), codeSentAt: new Date(), expiresAt };
      await tx.emailCode.create({ data: code });
      await tx.emailCode.create({ data: { ...code, purpose: 'password_reset' } });
      assert.equal((await tx.emailCode.findUnique({ where: { email_purpose: { email: code.email, purpose: 'register' } } })).attempts, 0);
      await rejected(() => tx.emailCode.create({ data: code }));
      await rejected(() => tx.emailCode.create({ data: { ...code, purpose: 'unknown' } }));
      await rejected(() => tx.emailCode.create({ data: { ...code, email: another.email.toUpperCase() } }));
      await rejected(() => tx.emailCode.create({ data: { ...code, email: another.email, codeHash: '123456' } }));
      await rejected(() => tx.emailCode.create({ data: { ...code, email: another.email, attempts: -1 } }));
      throw marker;
    }, { timeout: 10_000 }), error => error === marker);
  } finally {
    await database.disconnect();
  }
});

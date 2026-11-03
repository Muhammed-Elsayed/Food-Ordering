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

// Runs the real catalog services against PostgreSQL, inside a transaction that is rolled back.
test('PostgreSQL constraints and queries for categories, restaurants, and menus', {
  skip: process.env.RUN_DB_TESTS !== '1',
}, async () => {
  const { database } = require('../dist/db/index.js');
  const { CategoryService } = require('../dist/services/category-service.js');
  const { RestaurantService } = require('../dist/services/restaurant-service.js');
  const marker = new Error('Rollback test data');
  try {
    await database.connect();
    await assert.rejects(database.client.$transaction(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      async function rejected(operation) {
        await tx.$executeRawUnsafe('SAVEPOINT constraint_check');
        await assert.rejects(operation);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT constraint_check');
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT constraint_check');
      }

      const category = await tx.category.create({ data: { slug: `test-${suffix}`, name: 'Test food' } });
      const hidden = await tx.category.create({ data: { slug: `hidden-${suffix}`, name: 'Hidden', isActive: false } });
      const restaurantData = { name: 'Test Kitchen', deliveryFee: 2500, deliveryMinutesMin: 30, deliveryMinutesMax: 45 };
      const restaurant = await tx.restaurant.create({ data: {
        ...restaurantData, slug: `kitchen-${suffix}`, currency: 'EGP',
        categories: { create: [{ categoryId: category.id }, { categoryId: hidden.id }] },
        openingHours: { create: [0, 1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ dayOfWeek, opensAt: 0, closesAt: 1440 })) },
      } });
      const other = await tx.restaurant.create({ data: { ...restaurantData, slug: `other-${suffix}` } });

      // Slugs, names, money, delivery times, and opening hours.
      await rejected(() => tx.category.create({ data: { slug: `Upper-${suffix}`, name: 'Bad' } }));
      await rejected(() => tx.category.create({ data: { slug: category.slug, name: 'Duplicate' } }));
      await rejected(() => tx.restaurant.create({ data: { ...restaurantData, slug: `bad--slug-${suffix}` } }));
      await rejected(() => tx.restaurant.create({ data: { ...restaurantData, slug: `blank-${suffix}`, name: '  ' } }));
      await rejected(() => tx.restaurant.create({ data: { ...restaurantData, slug: `fee-${suffix}`, deliveryFee: -1 } }));
      await rejected(() => tx.restaurant.create({ data: { ...restaurantData, slug: `cur-${suffix}`, currency: 'egp' } }));
      await rejected(() => tx.restaurant.create({ data: { ...restaurantData, slug: `eta-${suffix}`, deliveryMinutesMax: 20 } }));
      await rejected(() => tx.restaurant.create({ data: { ...restaurantData, slug: `tel-${suffix}`, phone: '0100' } }));
      await rejected(() => tx.openingHours.create({ data: { restaurantId: other.id, dayOfWeek: 7, opensAt: 0, closesAt: 60 } }));
      await rejected(() => tx.openingHours.create({ data: { restaurantId: other.id, dayOfWeek: 1, opensAt: 600, closesAt: 600 } }));
      await rejected(() => tx.openingHours.create({ data: { restaurantId: other.id, dayOfWeek: 1, opensAt: 1440, closesAt: 60 } }));
      await rejected(() => tx.openingHours.create({ data: { restaurantId: restaurant.id, dayOfWeek: 1, opensAt: 0, closesAt: 60 } }));

      // Menu: items stay in their restaurant's sections, and use only their restaurant's option groups.
      const section = await tx.menuSection.create({ data: { restaurantId: restaurant.id, name: 'Mains', sortOrder: 1 } });
      const drinks = await tx.menuSection.create({ data: { restaurantId: restaurant.id, name: 'Drinks', sortOrder: 2 } });
      const otherSection = await tx.menuSection.create({ data: { restaurantId: other.id, name: 'Mains' } });
      const item = await tx.menuItem.create({ data: { restaurantId: restaurant.id, sectionId: section.id, name: 'Burger', price: 12000 } });
      await tx.menuItem.create({ data: { restaurantId: restaurant.id, sectionId: drinks.id, name: 'Old drink', price: 1000, isActive: false } });
      await rejected(() => tx.menuItem.create({ data: { restaurantId: restaurant.id, sectionId: otherSection.id, name: 'Stray', price: 100 } }));
      await rejected(() => tx.menuItem.create({ data: { restaurantId: restaurant.id, sectionId: section.id, name: 'Free?', price: -1 } }));
      const size = await tx.optionGroup.create({ data: { restaurantId: restaurant.id, name: 'Size', minSelect: 1, maxSelect: 1 } });
      const otherGroup = await tx.optionGroup.create({ data: { restaurantId: other.id, name: 'Extras' } });
      await rejected(() => tx.optionGroup.create({ data: { restaurantId: restaurant.id, name: 'Bad', minSelect: 2, maxSelect: 1 } }));
      await rejected(() => tx.optionGroup.create({ data: { restaurantId: restaurant.id, name: 'Bad', maxSelect: 0 } }));
      await tx.menuItemOptionGroup.create({ data: { menuItemId: item.id, optionGroupId: size.id, restaurantId: restaurant.id } });
      await rejected(() => tx.menuItemOptionGroup.create({ data: {
        menuItemId: item.id, optionGroupId: otherGroup.id, restaurantId: restaurant.id,
      } }));
      await rejected(() => tx.menuItemOptionGroup.create({ data: {
        menuItemId: item.id, optionGroupId: otherGroup.id, restaurantId: other.id,
      } }));
      await tx.menuOption.create({ data: { optionGroupId: size.id, name: 'Large', extraPrice: 3000, sortOrder: 2 } });
      await tx.menuOption.create({ data: { optionGroupId: size.id, name: 'Single', sortOrder: 1 } });
      await rejected(() => tx.menuOption.create({ data: { optionGroupId: size.id, name: 'Bad', extraPrice: -5 } }));

      // The services, through Prisma, against the real tables.
      const db = { client: tx };
      const categories = await new CategoryService(db).list();
      assert.equal(categories.some(c => c.slug === category.slug), true);
      assert.equal(categories.some(c => c.slug === hidden.slug), false);

      const restaurants = new RestaurantService(db);
      const page = await restaurants.list({ category: category.slug, page: 1, limit: 20 });
      assert.equal(page.total, 1);
      assert.equal(page.restaurants[0].slug, restaurant.slug);
      assert.deepEqual(page.restaurants[0].categories, [{ slug: category.slug, name: 'Test food' }]);
      assert.equal(page.restaurants[0].isOpen, true);
      assert.equal((await restaurants.list({ category: hidden.slug, page: 1, limit: 20 })).total, 0);

      const { restaurant: details, menu } = await restaurants.findBySlug(restaurant.slug);
      assert.equal(details.openingHours.length, 7);
      assert.deepEqual(details.openingHours[0], { dayOfWeek: 0, opens: '00:00', closes: '24:00' });
      assert.deepEqual(menu.map(s => s.name), ['Mains']);
      assert.deepEqual(menu[0].items[0].optionGroups[0].options.map(o => o.name), ['Single', 'Large']);
      await tx.restaurant.update({ where: { id: restaurant.id }, data: { isActive: false } });
      await assert.rejects(restaurants.findBySlug(restaurant.slug), { status: 404 });

      // Deleting a restaurant deletes its menu.
      await tx.restaurant.delete({ where: { id: restaurant.id } });
      assert.equal(await tx.menuOption.count({ where: { optionGroupId: size.id } }), 0);
      throw marker;
    }, { timeout: 10_000 }), error => error === marker);
  } finally {
    await database.disconnect();
  }
});

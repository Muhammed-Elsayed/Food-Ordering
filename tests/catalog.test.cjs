const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./app-harness.cjs');
const { formatMinutes, isWithinHours } = require('../dist/utilities/opening-hours.js');

// Copies a response out of the app's vm context so deepEqual compares plain values.
const plain = value => JSON.parse(JSON.stringify(value));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const allWeek = restaurantId => [0, 1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ restaurantId, dayOfWeek, opensAt: 0, closesAt: 1440 }));

// Burger and Pizza with one restaurant each, plus rows customers must never see.
const catalog = {
  category: [
    { id: id(1), slug: 'pizza', name: 'Pizza', sortOrder: 2 },
    { id: id(2), slug: 'burger', name: 'Burger', sortOrder: 1, imageUrl: 'https://img.example/burger.png' },
    { id: id(3), slug: 'retired', name: 'Retired', isActive: false },
  ],
  restaurant: [
    {
      id: id(10), slug: 'pizza-hut', name: 'Pizza Hut', sortOrder: 2, phone: '+201001234567',
      deliveryFee: 2500, minimumOrder: 15000, deliveryMinutesMin: 30, deliveryMinutesMax: 45,
    },
    { id: id(11), slug: 'buffalo-burger', name: 'Buffalo Burger', sortOrder: 1, deliveryFee: 2000, deliveryMinutesMin: 25, deliveryMinutesMax: 40 },
    { id: id(12), slug: 'paused-pizza', name: 'Paused Pizza', sortOrder: 3, isAcceptingOrders: false, deliveryFee: 0, deliveryMinutesMin: 20, deliveryMinutesMax: 30 },
    { id: id(13), slug: 'hidden-burger', name: 'Hidden Burger', isActive: false, deliveryFee: 0, deliveryMinutesMin: 20, deliveryMinutesMax: 30 },
    { id: id(14), slug: 'no-hours', name: 'No Hours', sortOrder: 4, deliveryFee: 0, deliveryMinutesMin: 20, deliveryMinutesMax: 30 },
  ],
  restaurantCategory: [
    { restaurantId: id(10), categoryId: id(1) }, { restaurantId: id(10), categoryId: id(3) },
    { restaurantId: id(11), categoryId: id(2) }, { restaurantId: id(12), categoryId: id(1) },
    { restaurantId: id(13), categoryId: id(2) },
  ],
  openingHours: [
    ...allWeek(id(10)), ...allWeek(id(11)), ...allWeek(id(12)), ...allWeek(id(13)),
    { restaurantId: id(10), dayOfWeek: 5, opensAt: 720, closesAt: 120 }, // Friday 12:00 to Saturday 02:00
  ],
  menuSection: [
    { id: id(20), restaurantId: id(10), name: 'Sides', sortOrder: 2 },
    { id: id(21), restaurantId: id(10), name: 'Pizzas', sortOrder: 1, description: 'Hand-stretched' },
    { id: id(22), restaurantId: id(10), name: 'Retired section', isActive: false },
    { id: id(23), restaurantId: id(10), name: 'Only removed items', sortOrder: 3 },
  ],
  menuItem: [
    { id: id(30), restaurantId: id(10), sectionId: id(21), name: 'Pepperoni', price: 16000, sortOrder: 2 },
    { id: id(31), restaurantId: id(10), sectionId: id(21), name: 'Margherita', price: 14000, sortOrder: 1 },
    { id: id(32), restaurantId: id(10), sectionId: id(21), name: 'Retired pizza', price: 1000, isActive: false },
    { id: id(33), restaurantId: id(10), sectionId: id(20), name: 'Garlic bread', price: 4000, isAvailable: false },
    { id: id(34), restaurantId: id(10), sectionId: id(20), name: 'Wings', price: 9000, sortOrder: 1 },
    { id: id(35), restaurantId: id(10), sectionId: id(22), name: 'In a retired section', price: 1000 },
    { id: id(36), restaurantId: id(10), sectionId: id(23), name: 'Removed', price: 1000, isActive: false },
  ],
  optionGroup: [
    { id: id(40), restaurantId: id(10), name: 'Size', minSelect: 1, maxSelect: 1 },
    { id: id(41), restaurantId: id(10), name: 'Extras', minSelect: 0, maxSelect: 3 },
    { id: id(42), restaurantId: id(10), name: 'Dip', minSelect: 1, maxSelect: 1 },
  ],
  menuItemOptionGroup: [
    { menuItemId: id(31), optionGroupId: id(41), restaurantId: id(10), sortOrder: 2 },
    { menuItemId: id(31), optionGroupId: id(40), restaurantId: id(10), sortOrder: 1 },
    { menuItemId: id(30), optionGroupId: id(40), restaurantId: id(10) },
    { menuItemId: id(34), optionGroupId: id(42), restaurantId: id(10) },
  ],
  menuOption: [
    { id: id(50), optionGroupId: id(40), name: 'Large', extraPrice: 6000, sortOrder: 2 },
    { id: id(51), optionGroupId: id(40), name: 'Medium', sortOrder: 1 },
    { id: id(52), optionGroupId: id(40), name: 'Family', extraPrice: 9000, isActive: false },
    { id: id(53), optionGroupId: id(41), name: 'Retired topping', isActive: false },
    { id: id(54), optionGroupId: id(42), name: 'Ranch', isAvailable: false },
  ],
};

const browse = () => setup(undefined, { catalog });

test('categories are public, active only, and in display order', async () => {
  const res = await browse().get('/categories');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(plain(res.body), { categories: [
    { id: id(2), slug: 'burger', name: 'Burger', imageUrl: 'https://img.example/burger.png' },
    { id: id(1), slug: 'pizza', name: 'Pizza', imageUrl: null },
  ] });
});

test('restaurants list active restaurants in display order with what a customer needs', async () => {
  const res = await browse().get('/restaurants');
  assert.equal(res.statusCode, 200);
  const body = plain(res.body);
  assert.deepEqual(body.restaurants.map(r => r.slug), ['buffalo-burger', 'pizza-hut', 'paused-pizza', 'no-hours']);
  assert.deepEqual({ page: body.page, limit: body.limit, total: body.total }, { page: 1, limit: 20, total: 4 });
  assert.deepEqual(body.restaurants[1], {
    id: id(10), slug: 'pizza-hut', name: 'Pizza Hut', description: null, logoUrl: null, coverUrl: null,
    categories: [{ slug: 'pizza', name: 'Pizza' }], currency: 'EGP', deliveryFee: 2500, minimumOrder: 15000,
    deliveryMinutes: { min: 30, max: 45 }, isOpen: true,
  });
});

test('a restaurant is closed when its switch is off or it has no opening hours', async () => {
  const { restaurants } = plain((await browse().get('/restaurants')).body);
  const isOpen = Object.fromEntries(restaurants.map(r => [r.slug, r.isOpen]));
  assert.deepEqual(isOpen, { 'buffalo-burger': true, 'pizza-hut': true, 'paused-pizza': false, 'no-hours': false });
});

test('restaurants filter by category and page through results', async () => {
  const app = browse();
  const slugs = async path => plain((await app.get(path)).body).restaurants.map(r => r.slug);
  assert.deepEqual(await slugs('/restaurants?category=pizza'), ['pizza-hut', 'paused-pizza']);
  assert.deepEqual(await slugs('/restaurants?category=%20Burger%20'), ['buffalo-burger']);
  assert.deepEqual(await slugs('/restaurants?category='), ['buffalo-burger', 'pizza-hut', 'paused-pizza', 'no-hours']);
  assert.deepEqual(await slugs('/restaurants?category=sushi'), []);
  assert.deepEqual(await slugs('/restaurants?category=retired'), []);

  const second = plain((await app.get('/restaurants?page=2&limit=1')).body);
  assert.deepEqual(second.restaurants.map(r => r.slug), ['pizza-hut']);
  assert.deepEqual({ page: second.page, limit: second.limit, total: second.total }, { page: 2, limit: 1, total: 4 });
  assert.deepEqual(await slugs('/restaurants?page=9'), []);
});

test('invalid restaurant list queries name every bad field', async () => {
  const app = browse();
  const res = await app.get('/restaurants?category=no%20spaces&page=0&limit=51');
  assert.equal(res.statusCode, 400);
  assert.deepEqual(plain(res.body), {
    error: 'BadRequestError', message: 'Some fields are invalid.',
    fields: {
      category: 'Use a category slug, for example pizza.',
      page: 'Use a whole number from 1 to 10000.', limit: 'Use a whole number from 1 to 50.',
    },
  });
  for (const query of ['page=1.5', 'page=-1', 'limit=abc', 'page=10001', 'category=pizza&category=burger']) {
    assert.equal((await app.get(`/restaurants?${query}`)).statusCode, 400, query);
  }
});

test('a restaurant page shows its details, opening hours, and menu', async () => {
  const res = await browse().get('/restaurants/pizza-hut');
  assert.equal(res.statusCode, 200);
  const { restaurant, menu } = plain(res.body);
  assert.equal(restaurant.phone, '+201001234567');
  assert.equal(restaurant.isOpen, true);
  assert.deepEqual(restaurant.categories, [{ slug: 'pizza', name: 'Pizza' }]);
  assert.equal(restaurant.openingHours.length, 8);
  assert.deepEqual(restaurant.openingHours.slice(5, 7), [
    { dayOfWeek: 5, opens: '00:00', closes: '24:00' },
    { dayOfWeek: 5, opens: '12:00', closes: '02:00' },
  ]);
  for (const hidden of ['timeZone', 'isAcceptingOrders', 'isActive', 'sortOrder', 'deliveryMinutesMin']) {
    assert.equal(hidden in restaurant, false, hidden);
  }

  assert.deepEqual(menu, [
    {
      id: id(21), name: 'Pizzas', description: 'Hand-stretched',
      items: [
        {
          id: id(31), name: 'Margherita', description: null, imageUrl: null, price: 14000, isAvailable: true,
          optionGroups: [{
            id: id(40), name: 'Size', minSelect: 1, maxSelect: 1,
            options: [
              { id: id(51), name: 'Medium', extraPrice: 0, isAvailable: true },
              { id: id(50), name: 'Large', extraPrice: 6000, isAvailable: true },
            ],
          }],
        },
        {
          id: id(30), name: 'Pepperoni', description: null, imageUrl: null, price: 16000, isAvailable: true,
          optionGroups: [{
            id: id(40), name: 'Size', minSelect: 1, maxSelect: 1,
            options: [
              { id: id(51), name: 'Medium', extraPrice: 0, isAvailable: true },
              { id: id(50), name: 'Large', extraPrice: 6000, isAvailable: true },
            ],
          }],
        },
      ],
    },
    {
      id: id(20), name: 'Sides', description: null,
      items: [
        { id: id(33), name: 'Garlic bread', description: null, imageUrl: null, price: 4000, isAvailable: false, optionGroups: [] },
        {
          // The only Dip is sold out, so Wings can't be ordered for now.
          id: id(34), name: 'Wings', description: null, imageUrl: null, price: 9000, isAvailable: false,
          optionGroups: [{
            id: id(42), name: 'Dip', minSelect: 1, maxSelect: 1,
            options: [{ id: id(54), name: 'Ranch', extraPrice: 0, isAvailable: false }],
          }],
        },
      ],
    },
  ]);
});

test('unknown and hidden restaurants are 404', async () => {
  const app = browse();
  for (const slug of ['sushi-place', 'hidden-burger', 'Pizza-Hut']) {
    const res = await app.get(`/restaurants/${slug}`);
    assert.equal(res.statusCode, 404, slug);
    assert.deepEqual(plain(res.body), { error: 'NotFoundError', message: 'This restaurant does not exist.' });
  }
});

test('opening hours use the restaurant\'s time zone and run past midnight', () => {
  // Friday 12:00 to 02:00 the next day, Cairo time (UTC+2 in winter, UTC+3 in summer).
  const friday = [{ dayOfWeek: 5, opensAt: 720, closesAt: 120 }];
  const cairo = 'Africa/Cairo';
  assert.equal(isWithinHours(friday, cairo, new Date('2026-11-06T09:59:00Z')), false); // Fri 11:59
  assert.equal(isWithinHours(friday, cairo, new Date('2026-11-06T10:00:00Z')), true); // Fri 12:00
  assert.equal(isWithinHours(friday, cairo, new Date('2026-11-06T23:30:00Z')), true); // Sat 01:30
  assert.equal(isWithinHours(friday, cairo, new Date('2026-11-07T00:00:00Z')), false); // Sat 02:00
  assert.equal(isWithinHours(friday, cairo, new Date('2026-11-07T10:30:00Z')), false); // Sat 12:30
  assert.equal(isWithinHours(friday, 'UTC', new Date('2026-11-06T10:30:00Z')), false); // Fri 10:30 in UTC

  const lunch = [{ dayOfWeek: 2, opensAt: 660, closesAt: 900 }]; // Tuesday 11:00 to 15:00
  assert.equal(isWithinHours(lunch, cairo, new Date('2026-11-03T08:59:00Z')), false); // 10:59
  assert.equal(isWithinHours(lunch, cairo, new Date('2026-11-03T12:59:00Z')), true); // 14:59
  assert.equal(isWithinHours(lunch, cairo, new Date('2026-11-03T13:00:00Z')), false); // 15:00
  assert.equal(isWithinHours(lunch, 'Not/AZone', new Date('2026-11-03T12:00:00Z')), false);
  assert.equal(isWithinHours([], cairo, new Date()), false);

  assert.deepEqual([0, 75, 720, 1439, 1440].map(formatMinutes), ['00:00', '01:15', '12:00', '23:59', '24:00']);
});

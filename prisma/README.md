# Database

PostgreSQL, managed with Prisma 7. Models are in `prisma/schema` (one file per model) and
migrations in `prisma/migrations`. The generated client is written to `src/db/generated`
during `npm run build`. `prisma.config.ts` points the CLI at these folders and reads
`DATABASE_URL` from `.env`.

## Local setup

1. Install and start PostgreSQL.
2. Create a database and a role that owns it. Don't use a superuser:

   ```sql
   CREATE ROLE food_ordering LOGIN PASSWORD 'choose-a-password';
   CREATE DATABASE food_ordering OWNER food_ordering;
   ```

   `npm run db:migrate` also needs to create a temporary shadow database, so give the role
   `CREATEDB` in development (`ALTER ROLE food_ordering CREATEDB;`).
3. Put the URL in `.env`. URL-encode special characters in the password:

   ```env
   DATABASE_URL=postgresql://food_ordering:choose-a-password@localhost:5432/food_ordering?schema=public
   ```

4. Apply the migrations and check the connection:

   ```bash
   npm run db:deploy
   npm run db:check
   ```

## Changing the schema

Edit or add a file in `prisma/schema`, then create a migration and regenerate the client:

```bash
npm run db:migrate -- --name describe_the_change
npm run db:generate
```

- `db:deploy` applies existing migrations; `db:migrate` creates new ones (it needs an
  interactive terminal).
- Never edit an applied migration, not even its comments. Prisma checksums every file.
- Prisma can't express CHECK constraints or partial indexes. Add them by hand to the
  generated `migration.sql` before applying it.
- Don't use `prisma db push`; it bypasses the migration history.
- `npm run db:studio` opens Prisma's database browser.

## Tables

### `users`

| Column | Notes |
| --- | --- |
| `id` | UUID |
| `email` | Unique, stored trimmed and lowercase |
| `first_name`, `last_name` | Optional (Google may not send them), never blank |
| `phone` | Optional, E.164 format (`+201001234567`) |
| `phone_verified` | Requires `phone`. Verified phones are unique |
| `email_verified` | True for Google accounts and verified sign-ups |
| `is_active` | False blocks login, refresh, and existing sessions |
| `password_hash` | argon2id, for password accounts |
| `google_sub` | Unique Google account ID, for Google accounts |
| `created_at`, `updated_at` | Timestamps |

At least one of `password_hash` and `google_sub` must be set. The app always sets exactly
one, because accounts are never linked. Phones are unique only once verified (partial index
`users_verified_phone_unique`), so typing someone else's number can't block its owner.

### `sessions`

One row per logged-in device.

| Column | Notes |
| --- | --- |
| `id` | UUID, carried in access tokens as `sid` |
| `user_id` | The user; deleting a user deletes their sessions |
| `refresh_token_hash` | Unique SHA-256 hex digest of the refresh token, never the token itself |
| `expires_at` | One day after the last login or refresh |
| `created_at`, `updated_at` | Timestamps |

A refresh updates the row only if it still has the old hash, so only one of two parallel
refreshes with the same token succeeds. Logout deletes all of a user's rows. Expired rows
are removed the next time that user logs in.

### `email_codes`

One-time 6-digit codes sent by email, at most one per email and purpose.

| Column | Notes |
| --- | --- |
| `email` | Stored trimmed and lowercase |
| `purpose` | Enum `email_code_purpose`: `register` or `password_reset`. Key: (`email`, `purpose`) |
| `code_hash` | HMAC-SHA256 of `purpose:email:code`, keyed with `OTP_SECRET_KEY`. A code only works for its purpose |
| `code_sent_at` | For the 60-second cooldown between codes |
| `expires_at` | 10 minutes after the code was sent |
| `attempts` | Wrong guesses for the current code, at most 5; counted before comparing |
| `created_at` | Timestamp |

Sending a new code replaces the row and resets `attempts`. A row is deleted once its code is
used. To add a new kind of code, add a value to the enum in a migration.

### `pending_registrations`

An email/password sign-up waiting for its code (`email_codes` with purpose `register`). The
user row is created only after the code is verified.

| Column | Notes |
| --- | --- |
| `email` | Primary key, stored trimmed and lowercase |
| `password_hash` | argon2id |
| `first_name`, `last_name` | Never blank |
| `phone` | Optional, E.164 |
| `created_at` | Timestamp |

Registering again with the same email replaces the details. Rows are deleted once verified.
Rows and codes that are never used stay in their tables for now.

### Restaurants and menus

```
categories ──< restaurant_categories >── restaurants
restaurants ──< opening_hours
restaurants ──< menu_sections ──< menu_items ──< menu_item_option_groups >── option_groups ──< menu_options
restaurants ──< option_groups      (──< means "has many")
```

Money columns (`delivery_fee`, `minimum_order`, `price`, `extra_price`) are whole amounts in
the smallest unit of the restaurant's `currency` (piasters for EGP), never negative. Rows
customers should not see are hidden with `is_active = false` rather than deleted, so carts and
orders that point at them keep working. Deleting a restaurant deletes its whole menu.

| Table | Notes |
| --- | --- |
| `categories` | `slug` is unique, lowercase with hyphens (`pizza`). `sort_order` and `is_active` control the home screen |
| `restaurants` | Unique `slug`. `currency` (ISO 4217, default `EGP`), `delivery_fee`, `minimum_order`, `delivery_minutes_min/max`, `time_zone` (default `Africa/Cairo`). `is_accepting_orders` is the restaurant's switch; `is_active = false` hides it |
| `restaurant_categories` | Many-to-many: a restaurant can be in several categories |
| `opening_hours` | One row per period: `day_of_week` (0 = Sunday), `opens_at` and `closes_at` in minutes from midnight. `closes_at <= opens_at` ends the next day; `0` to `1440` is all day. A day with no rows is closed |
| `menu_sections` | Headings such as "Pizzas" or "Drinks", ordered by `sort_order` |
| `menu_items` | `price`. `is_available = false` is sold out (still shown); `is_active = false` removes it. A composite foreign key keeps an item in a section of its own restaurant |
| `option_groups` | A choice such as Size: pick `min_select` to `max_select` options (`min_select >= 1` makes it required). Belongs to a restaurant and is shared by its items |
| `menu_item_option_groups` | Attaches groups to items in `sort_order`. `restaurant_id` is part of both foreign keys, so an item can only use its own restaurant's groups |
| `menu_options` | One choice in a group, with `extra_price` added to the item price, `is_available`, and `is_active` |

The API only reads these tables for now. Branches with their own locations and hours come
later; opening hours will move to them.

## Verification

```bash
npm run db:validate   # schema is valid
npm run db:check      # the app can connect
npm run test:db       # constraint tests, inside a transaction that is rolled back
```

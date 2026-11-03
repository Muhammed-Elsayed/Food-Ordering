-- AlterTable
ALTER TABLE "users" ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Custom checks Prisma cannot express. Keep them in later migrations.
-- Every account needs a login method: a password, a linked Google account, or both.
ALTER TABLE "users" ADD CONSTRAINT "users_login_method_check"
    CHECK ("password_hash" IS NOT NULL OR "google_sub" IS NOT NULL);

-- Store emails trimmed and lowercase so the unique index also catches case variants.
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized_check"
    CHECK ("email" <> '' AND "email" = lower(btrim("email")));

ALTER TABLE "users" ADD CONSTRAINT "users_google_sub_not_blank_check"
    CHECK ("google_sub" IS NULL OR btrim("google_sub") <> '');

-- A refresh session is either fully present or fully revoked.
ALTER TABLE "users" ADD CONSTRAINT "users_refresh_token_pair_check"
    CHECK (("refresh_token_hash" IS NULL) = ("refresh_token_expires_at" IS NULL));

-- Only a SHA-256 hex digest is stored, never the raw refresh token.
ALTER TABLE "users" ADD CONSTRAINT "users_refresh_token_hash_format_check"
    CHECK ("refresh_token_hash" IS NULL OR "refresh_token_hash" ~ '^[0-9a-f]{64}$');

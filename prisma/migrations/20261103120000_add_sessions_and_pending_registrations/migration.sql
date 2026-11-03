-- DropIndex
DROP INDEX "users_refresh_token_hash_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "active_token_id",
DROP COLUMN "refresh_token_expires_at",
DROP COLUMN "refresh_token_hash";

-- CreateTable
CREATE TABLE "pending_registrations" (
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "code_hash" TEXT NOT NULL,
    "code_sent_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_registrations_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Only a SHA-256 hex digest is stored, never the raw refresh token.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_refresh_token_hash_format_check"
    CHECK ("refresh_token_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "pending_registrations" ADD CONSTRAINT "pending_registrations_email_normalized_check"
    CHECK ("email" <> '' AND "email" = lower(btrim("email")));

ALTER TABLE "pending_registrations" ADD CONSTRAINT "pending_registrations_names_not_blank_check"
    CHECK (btrim("first_name") <> '' AND btrim("last_name") <> '');

ALTER TABLE "pending_registrations" ADD CONSTRAINT "pending_registrations_phone_format_check"
    CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$');

-- Only an HMAC-SHA256 hex digest of the code is stored.
ALTER TABLE "pending_registrations" ADD CONSTRAINT "pending_registrations_code_hash_format_check"
    CHECK ("code_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "pending_registrations" ADD CONSTRAINT "pending_registrations_attempts_check"
    CHECK ("attempts" >= 0);

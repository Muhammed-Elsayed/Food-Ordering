-- Waiting sign-ups lose their codes below and could never be verified; they register again.
DELETE FROM "pending_registrations";

-- CreateEnum
CREATE TYPE "email_code_purpose" AS ENUM ('register', 'password_reset');

-- AlterTable
ALTER TABLE "pending_registrations" DROP COLUMN "attempts",
DROP COLUMN "code_hash",
DROP COLUMN "code_sent_at",
DROP COLUMN "expires_at";

-- CreateTable
CREATE TABLE "email_codes" (
    "email" TEXT NOT NULL,
    "purpose" "email_code_purpose" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "code_sent_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_codes_pkey" PRIMARY KEY ("email","purpose")
);


ALTER TABLE "email_codes" ADD CONSTRAINT "email_codes_email_normalized_check"
    CHECK ("email" <> '' AND "email" = lower(btrim("email")));

-- Only an HMAC-SHA256 hex digest of the code is stored.
ALTER TABLE "email_codes" ADD CONSTRAINT "email_codes_code_hash_format_check"
    CHECK ("code_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "email_codes" ADD CONSTRAINT "email_codes_attempts_check"
    CHECK ("attempts" >= 0);

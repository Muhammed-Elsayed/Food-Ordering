-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phone_verified" BOOLEAN NOT NULL DEFAULT false;

-- Phone is optional and collected after sign-up. When present, store it in international
-- (E.164) format: "+" then 8 to 15 digits, e.g. +201001234567.
ALTER TABLE "users" ADD CONSTRAINT "users_phone_format_check"
    CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$');

-- Only a phone that exists can be verified (by OTP).
ALTER TABLE "users" ADD CONSTRAINT "users_phone_verified_check"
    CHECK (NOT "phone_verified" OR "phone" IS NOT NULL);

-- Unique only once verified: typing someone else's number cannot block its owner.
-- Prisma cannot express partial indexes, so this lives in SQL only.
CREATE UNIQUE INDEX "users_verified_phone_unique" ON "users"("phone") WHERE "phone_verified";

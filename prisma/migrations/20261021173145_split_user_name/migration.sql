/*
  Warnings:

  - You are about to drop the column `full_name` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "full_name",
ADD COLUMN     "first_name" TEXT,
ADD COLUMN     "last_name" TEXT;

-- Names are optional (Google may omit them), but never stored as blank strings.
ALTER TABLE "users" ADD CONSTRAINT "users_first_name_not_blank_check"
    CHECK ("first_name" IS NULL OR btrim("first_name") <> '');

ALTER TABLE "users" ADD CONSTRAINT "users_last_name_not_blank_check"
    CHECK ("last_name" IS NULL OR btrim("last_name") <> '');

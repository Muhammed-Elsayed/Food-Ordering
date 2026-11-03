-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_option_groups" (
    "menu_item_id" UUID NOT NULL,
    "option_group_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "menu_item_option_groups_pkey" PRIMARY KEY ("menu_item_id","option_group_id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "price" INTEGER NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "option_group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "extra_price" INTEGER NOT NULL DEFAULT 0,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "opens_at" SMALLINT NOT NULL,
    "closes_at" SMALLINT NOT NULL,

    CONSTRAINT "opening_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_categories" (
    "restaurant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "restaurant_categories_pkey" PRIMARY KEY ("restaurant_id","category_id")
);

-- CreateTable
CREATE TABLE "restaurants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logo_url" TEXT,
    "cover_url" TEXT,
    "phone" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "delivery_fee" INTEGER NOT NULL,
    "minimum_order" INTEGER NOT NULL DEFAULT 0,
    "delivery_minutes_min" INTEGER NOT NULL,
    "delivery_minutes_max" INTEGER NOT NULL,
    "time_zone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
    "is_accepting_orders" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "menu_item_option_groups_option_group_id_idx" ON "menu_item_option_groups"("option_group_id");

-- CreateIndex
CREATE INDEX "menu_items_section_id_idx" ON "menu_items"("section_id");

-- CreateIndex
CREATE INDEX "menu_items_restaurant_id_idx" ON "menu_items"("restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "menu_items_id_restaurant_id_key" ON "menu_items"("id", "restaurant_id");

-- CreateIndex
CREATE INDEX "menu_options_option_group_id_idx" ON "menu_options"("option_group_id");

-- CreateIndex
CREATE INDEX "menu_sections_restaurant_id_idx" ON "menu_sections"("restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "menu_sections_id_restaurant_id_key" ON "menu_sections"("id", "restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "opening_hours_restaurant_day_opens_key" ON "opening_hours"("restaurant_id", "day_of_week", "opens_at");

-- CreateIndex
CREATE INDEX "option_groups_restaurant_id_idx" ON "option_groups"("restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "option_groups_id_restaurant_id_key" ON "option_groups"("id", "restaurant_id");

-- CreateIndex
CREATE INDEX "restaurant_categories_category_id_idx" ON "restaurant_categories"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_slug_key" ON "restaurants"("slug");

-- AddForeignKey
ALTER TABLE "menu_item_option_groups" ADD CONSTRAINT "menu_item_option_groups_menu_item_id_restaurant_id_fkey" FOREIGN KEY ("menu_item_id", "restaurant_id") REFERENCES "menu_items"("id", "restaurant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_option_groups" ADD CONSTRAINT "menu_item_option_groups_option_group_id_restaurant_id_fkey" FOREIGN KEY ("option_group_id", "restaurant_id") REFERENCES "option_groups"("id", "restaurant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_section_id_restaurant_id_fkey" FOREIGN KEY ("section_id", "restaurant_id") REFERENCES "menu_sections"("id", "restaurant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_options" ADD CONSTRAINT "menu_options_option_group_id_fkey" FOREIGN KEY ("option_group_id") REFERENCES "option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_sections" ADD CONSTRAINT "menu_sections_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_hours" ADD CONSTRAINT "opening_hours_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_categories" ADD CONSTRAINT "restaurant_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_categories" ADD CONSTRAINT "restaurant_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Slugs appear in URLs: lowercase letters and digits separated by single hyphens.
ALTER TABLE "categories" ADD CONSTRAINT "categories_slug_format_check"
    CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "categories" ADD CONSTRAINT "categories_name_not_blank_check"
    CHECK (btrim("name") <> '');

ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_slug_format_check"
    CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_name_not_blank_check"
    CHECK (btrim("name") <> '');

ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_phone_format_check"
    CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$');

-- ISO 4217 code, such as EGP.
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_currency_format_check"
    CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_amounts_check"
    CHECK ("delivery_fee" >= 0 AND "minimum_order" >= 0);

ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_delivery_minutes_check"
    CHECK ("delivery_minutes_min" > 0 AND "delivery_minutes_max" >= "delivery_minutes_min");

ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_time_zone_not_blank_check"
    CHECK (btrim("time_zone") <> '');

-- opens_at is 00:00 to 23:59 and closes_at 00:01 to 24:00, in minutes. closes_at <= opens_at
-- means the period ends the next day; 0 to 1440 is open all day.
ALTER TABLE "opening_hours" ADD CONSTRAINT "opening_hours_day_of_week_check"
    CHECK ("day_of_week" BETWEEN 0 AND 6);

ALTER TABLE "opening_hours" ADD CONSTRAINT "opening_hours_times_check"
    CHECK ("opens_at" BETWEEN 0 AND 1439 AND "closes_at" BETWEEN 1 AND 1440 AND "opens_at" <> "closes_at");

ALTER TABLE "menu_sections" ADD CONSTRAINT "menu_sections_name_not_blank_check"
    CHECK (btrim("name") <> '');

ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_name_not_blank_check"
    CHECK (btrim("name") <> '');

ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_price_check"
    CHECK ("price" >= 0);

ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_name_not_blank_check"
    CHECK (btrim("name") <> '');

ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_select_range_check"
    CHECK ("min_select" >= 0 AND "max_select" >= 1 AND "max_select" >= "min_select");

ALTER TABLE "menu_options" ADD CONSTRAINT "menu_options_name_not_blank_check"
    CHECK (btrim("name") <> '');

ALTER TABLE "menu_options" ADD CONSTRAINT "menu_options_extra_price_check"
    CHECK ("extra_price" >= 0);

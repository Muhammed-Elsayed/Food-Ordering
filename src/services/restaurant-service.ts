import { database, type Database } from "../db/index.js";
import type { Prisma } from "../db/generated/prisma/client.js";
import type {
  PublicMenuSection, PublicRestaurant, RestaurantDetails, RestaurantListQuery, RestaurantPage,
} from "../schemas/restaurant-schemas.js";
import { formatMinutes, isWithinHours } from "../utilities/opening-hours.js";
import { WebError } from "../utilities/web-errors.js";

// Display order for anything with sortOrder and name; the name breaks ties.
const displayOrder = () => [{ sortOrder: "asc" as const }, { name: "asc" as const }];

// Customers never see inactive (hidden) rows. Sold-out items and options are shown, with
// isAvailable false.
const restaurantSelect = {
  id: true, slug: true, name: true, description: true, logoUrl: true, coverUrl: true, currency: true,
  deliveryFee: true, minimumOrder: true, deliveryMinutesMin: true, deliveryMinutesMax: true,
  timeZone: true, isAcceptingOrders: true,
  categories: {
    where: { category: { isActive: true } },
    select: { category: { select: { slug: true, name: true, sortOrder: true } } },
  },
  openingHours: {
    orderBy: [{ dayOfWeek: "asc" }, { opensAt: "asc" }],
    select: { dayOfWeek: true, opensAt: true, closesAt: true },
  },
} satisfies Prisma.RestaurantSelect;

const restaurantDetailsSelect = {
  ...restaurantSelect,
  phone: true,
  sections: {
    where: { isActive: true }, orderBy: displayOrder(),
    select: {
      id: true, name: true, description: true,
      items: {
        where: { isActive: true }, orderBy: displayOrder(),
        select: {
          id: true, name: true, description: true, imageUrl: true, price: true, isAvailable: true,
          optionGroups: {
            orderBy: [{ sortOrder: "asc" }, { optionGroupId: "asc" }],
            select: {
              optionGroup: {
                select: {
                  id: true, name: true, minSelect: true, maxSelect: true,
                  options: {
                    where: { isActive: true }, orderBy: displayOrder(),
                    select: { id: true, name: true, extraPrice: true, isAvailable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.RestaurantSelect;

type RestaurantRow = Prisma.RestaurantGetPayload<{ select: typeof restaurantSelect }>;
type MenuRows = Prisma.RestaurantGetPayload<{ select: typeof restaurantDetailsSelect }>["sections"];

// Open only when the restaurant's switch is on and it is within its hours.
const toPublicRestaurant = (row: RestaurantRow, now: Date): PublicRestaurant => ({
  id: row.id, slug: row.slug, name: row.name, description: row.description, logoUrl: row.logoUrl,
  coverUrl: row.coverUrl,
  categories: row.categories.map(({ category }) => category)
    .sort((a, b) => a.sortOrder - b.sortOrder).map(({ slug, name }) => ({ slug, name })),
  currency: row.currency, deliveryFee: row.deliveryFee, minimumOrder: row.minimumOrder,
  deliveryMinutes: { min: row.deliveryMinutesMin, max: row.deliveryMinutesMax },
  isOpen: row.isAcceptingOrders && isWithinHours(row.openingHours, row.timeZone, now),
});

// Leaves out sections with no items and option groups with no options. An item is unavailable
// while one of its required choices has too few available options.
const toMenu = (sections: MenuRows): PublicMenuSection[] => sections
  .map(({ items, ...section }) => ({
    ...section,
    items: items.map(({ optionGroups, ...item }) => {
      const groups = optionGroups.map(({ optionGroup }) => optionGroup);
      const choosable = groups.every((group) =>
        group.options.filter((option) => option.isAvailable).length >= group.minSelect);
      return {
        ...item, isAvailable: item.isAvailable && choosable,
        optionGroups: groups.filter((group) => group.options.length > 0),
      };
    }),
  }))
  .filter((section) => section.items.length > 0);

export class RestaurantService {
  constructor(private readonly db: Database) {}

  // Active restaurants in display order, optionally only those in one active category.
  async list({ category, page, limit }: RestaurantListQuery): Promise<RestaurantPage> {
    const where = {
      isActive: true,
      ...(category ? { categories: { some: { category: { slug: category, isActive: true } } } } : {}),
    } satisfies Prisma.RestaurantWhereInput;
    const [rows, total] = await Promise.all([
      this.db.client.restaurant.findMany({
        where, orderBy: displayOrder(), skip: (page - 1) * limit, take: limit, select: restaurantSelect,
      }),
      this.db.client.restaurant.count({ where }),
    ]);
    const now = new Date();
    return { restaurants: rows.map((row) => toPublicRestaurant(row, now)), page, limit, total };
  }

  // The restaurant page: details, opening hours, and the menu.
  async findBySlug(slug: string): Promise<{ restaurant: RestaurantDetails; menu: PublicMenuSection[] }> {
    const row = await this.db.client.restaurant.findUnique({
      where: { slug, isActive: true }, select: restaurantDetailsSelect,
    });
    if (!row) throw WebError.NotFound("This restaurant does not exist.");

    const { sections, phone, ...restaurant } = row;
    return {
      restaurant: {
        ...toPublicRestaurant(restaurant, new Date()), phone,
        openingHours: row.openingHours.map(({ dayOfWeek, opensAt, closesAt }) => ({
          dayOfWeek, opens: formatMinutes(opensAt), closes: formatMinutes(closesAt),
        })),
      },
      menu: toMenu(sections),
    };
  }
}

export const restaurantService = new RestaurantService(database);

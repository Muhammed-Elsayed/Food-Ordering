import { readInput } from "./request-schemas.js";

// Prices, fees, and minimum orders are whole amounts in the smallest unit of `currency`
// (piasters for EGP): 12500 is 125.00 EGP.

export interface OpeningPeriod {
  dayOfWeek: number; // 0 = Sunday
  opens: string; // "12:00"
  closes: string; // "02:00" (the next day when not after opens), "24:00" for midnight
}

// A restaurant in a list, as shown to customers.
export interface PublicRestaurant {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  categories: { slug: string; name: string }[];
  currency: string;
  deliveryFee: number;
  minimumOrder: number;
  deliveryMinutes: { min: number; max: number };
  isOpen: boolean;
}

export interface RestaurantDetails extends PublicRestaurant {
  phone: string | null;
  openingHours: OpeningPeriod[];
}

export interface PublicMenuOption {
  id: string;
  name: string;
  extraPrice: number;
  isAvailable: boolean;
}

export interface PublicOptionGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: PublicMenuOption[];
}

export interface PublicMenuItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  isAvailable: boolean;
  optionGroups: PublicOptionGroup[];
}

export interface PublicMenuSection {
  id: string;
  name: string;
  description: string | null;
  items: PublicMenuItem[];
}

export interface RestaurantListQuery {
  category: string | null;
  page: number;
  limit: number;
}

export interface RestaurantPage {
  restaurants: PublicRestaurant[];
  page: number;
  limit: number;
  total: number;
}

// Same rule as the database CHECK on categories.slug and restaurants.slug.
const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const pageSize = { default: 20, max: 50 };
const maxPage = 10_000;

export function parseRestaurantQuery(query: unknown): RestaurantListQuery {
  const { values, fields, text, throwIfInvalid } = readInput(query);

  // `?category=` with no value means every category; a repeated parameter is invalid.
  let category: string | null = null;
  if (values.category !== undefined && values.category !== "") {
    category = text("category")?.trim().toLowerCase() ?? "";
    if (category.length > 100 || !slugPattern.test(category)) fields.category = "Use a category slug, for example pizza.";
  }

  const wholeNumber = (key: string, fallback: number, max: number) => {
    if (values[key] === undefined) return fallback;
    const raw = text(key)?.trim() ?? "";
    const value = /^[0-9]{1,6}$/.test(raw) ? Number(raw) : 0;
    if (value < 1 || value > max) fields[key] = `Use a whole number from 1 to ${max}.`;
    return value;
  };
  const page = wholeNumber("page", 1, maxPage);
  const limit = wholeNumber("limit", pageSize.default, pageSize.max);

  throwIfInvalid();
  return { category, page, limit };
}

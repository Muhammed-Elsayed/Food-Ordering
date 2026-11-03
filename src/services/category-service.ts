import { database, type Database } from "../db/index.js";
import type { PublicCategory } from "../schemas/category-schemas.js";

export class CategoryService {
  constructor(private readonly db: Database) {}

  // Active categories in display order.
  list(): Promise<PublicCategory[]> {
    return this.db.client.category.findMany({
      where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true, imageUrl: true },
    });
  }
}

export const categoryService = new CategoryService(database);

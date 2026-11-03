import type { RequestHandler } from "express";
import type { CategoryService } from "../services/category-service.js";

// HTTP only: call CategoryService, send the response.
class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  public readonly list: RequestHandler = async (_req, res) => {
    res.json({ categories: await this.categories.list() });
  };
}

export default CategoryController;

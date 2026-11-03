import { Router } from "express";
import type CategoryController from "../controllers/category-controller.js";

class CategoryRoutes {
  public readonly router = Router();

  constructor(private readonly controller: CategoryController) {
    this.initializeCategoryRoutes();
  }

  // Public: browsing needs no login.
  private initializeCategoryRoutes() {
    this.router.get("/", this.controller.list);
  }
}

export default CategoryRoutes;

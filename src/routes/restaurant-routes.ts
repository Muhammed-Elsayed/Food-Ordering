import { Router } from "express";
import type RestaurantController from "../controllers/restaurant-controller.js";
import { validate } from "../middleware/validate.js";
import { parseRestaurantQuery } from "../schemas/restaurant-schemas.js";

class RestaurantRoutes {
  public readonly router = Router();

  constructor(private readonly controller: RestaurantController) {
    this.initializeRestaurantRoutes();
  }

  // Public: browsing needs no login.
  private initializeRestaurantRoutes() {
    const controller = this.controller;

    this.router.get("/", validate(parseRestaurantQuery, "query"), controller.list);
    this.router.get("/:slug", controller.details);
  }
}

export default RestaurantRoutes;

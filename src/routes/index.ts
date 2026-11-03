import { Router } from "express";
import AuthController from "../controllers/auth-controller.js";
import CategoryController from "../controllers/category-controller.js";
import RestaurantController from "../controllers/restaurant-controller.js";
import type { RoutesConfig } from "../schemas/routes-schemas.js";
import { authService } from "../services/auth-service.js";
import { categoryService } from "../services/category-service.js";
import { restaurantService } from "../services/restaurant-service.js";
import AuthRoutes from "./auth-routes.js";
import CategoryRoutes from "./category-routes.js";
import RestaurantRoutes from "./restaurant-routes.js";

class MainRoutes {
  public readonly router = Router();
  private readonly auth: AuthRoutes;
  private readonly categories = new CategoryRoutes(new CategoryController(categoryService));
  private readonly restaurants = new RestaurantRoutes(new RestaurantController(restaurantService));

  constructor(config: RoutesConfig) {
    this.auth = new AuthRoutes(config.googleAuth, new AuthController(authService));
    this.initializeAppRoutes();
  }

  private initializeAppRoutes() {
    // Liveness only: does not touch the database.
    this.router.get("/health", (_req, res) => {
      res.json({ status: "ok" });
    });
    this.router.use("/auth", this.auth.router);
    this.router.use("/categories", this.categories.router);
    this.router.use("/restaurants", this.restaurants.router);
  }
}

export default MainRoutes;

import { Router } from "express";
import AuthController from "../controllers/auth-controller.js";
import type { RoutesConfig } from "../schemas/routes-schemas.js";
import { authService } from "../services/auth-service.js";
import AuthRoutes from "./auth-routes.js";

class MainRoutes {
  public readonly router = Router();
  private readonly auth: AuthRoutes;

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
  }
}

export default MainRoutes;

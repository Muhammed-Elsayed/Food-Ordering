import cors from "cors";
import express from "express";
import { googleAuthConfig } from "./config/index.js";
import { errorHandler } from "./middleware/error-handler.js";
import MainRoutes from "./routes/index.js";

export function createApp() {
  const app = express();
  const mainRoutes = new MainRoutes({ googleAuth: googleAuthConfig });

  // Allows every origin for now. Restrict to the frontend's origin before launch.
  app.use(cors());
  app.use(express.json({ limit: "10kb" }));
  app.use(mainRoutes.router);
  app.use(errorHandler);

  return app;
}

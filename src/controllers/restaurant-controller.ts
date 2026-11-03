import type { RequestHandler } from "express";
import type { ValidatedHandler } from "../schemas/request-schemas.js";
import type { RestaurantListQuery } from "../schemas/restaurant-schemas.js";
import type { RestaurantService } from "../services/restaurant-service.js";

// HTTP only: read the validated query or the slug, call RestaurantService, send the response.
class RestaurantController {
  constructor(private readonly restaurants: RestaurantService) {}

  public readonly list: ValidatedHandler<RestaurantListQuery> = async (_req, res) => {
    res.json(await this.restaurants.list(res.locals.input));
  };

  public readonly details: RequestHandler<{ slug: string }> = async (req, res) => {
    res.json(await this.restaurants.findBySlug(req.params.slug));
  };
}

export default RestaurantController;

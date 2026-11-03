import type { BodyParser, ValidatedHandler } from "../schemas/request-schemas.js";

// Stores the parsed body (or query string) in res.locals.input; invalid input throws to the
// error handler.
export const validate = <Input>(parse: BodyParser<Input>, source: "body" | "query" = "body"): ValidatedHandler<Input> =>
  (req, res, next) => {
    res.locals.input = parse(source === "query" ? req.query : req.body);
    next();
  };

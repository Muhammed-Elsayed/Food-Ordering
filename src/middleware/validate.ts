import type { BodyParser, ValidatedHandler } from "../schemas/request-schemas.js";

// Stores the parsed body in res.locals.input; invalid input throws to the error handler.
export const validate = <Input>(parse: BodyParser<Input>): ValidatedHandler<Input> => (req, res, next) => {
  res.locals.input = parse(req.body);
  next();
};

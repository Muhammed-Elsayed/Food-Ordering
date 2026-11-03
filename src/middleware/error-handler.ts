import type { ErrorRequestHandler } from "express";
import { WebError } from "../utilities/web-errors.js";

// Errors from express.json(), such as malformed JSON or a body over the size limit.
const isBodyParserError = (error: unknown): error is { status: number } =>
  typeof error === "object" && error !== null && "type" in error && "status" in error &&
  typeof error.status === "number" && error.status >= 400 && error.status < 500;

// Mount last. WebErrors carry safe messages; anything else becomes a generic 500.
export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof WebError) {
    res.status(error.status).json({ error: error.name, message: error.message, ...error.details });
    return;
  }
  if (isBodyParserError(error)) {
    res.status(error.status).json({ error: "BadRequestError", message: "The request body must be valid JSON of at most 10 KB." });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "InternalServerError", message: "Something went wrong. Try again." });
};

import type { RequestHandler } from "express";
import type { ParamsDictionary, Query } from "express-serve-static-core";
import { WebError } from "../utilities/web-errors.js";
import type { PublicUser } from "./user-schemas.js";

export type BodyParser<Input> = (body: unknown) => Input;

// Collects every invalid field so the client can show all problems at once. Works for a JSON
// body or a query string.
export function readInput(input: unknown) {
  const fields: Record<string, string> = {};
  const values = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const text = (key: string) => typeof values[key] === "string" ? values[key] : undefined;
  const throwIfInvalid = () => {
    if (Object.keys(fields).length) throw WebError.BadRequest("Some fields are invalid.", { fields });
  };
  return { values, fields, text, throwIfInvalid };
}

// Set by verifyToken.
export interface AuthenticatedLocals {
  user: PublicUser;
  sessionId: string;
}

// A handler mounted after validate(parser), and after verifyToken when Locals says so.
export type ValidatedHandler<Input, Locals extends object = object> =
  RequestHandler<ParamsDictionary, unknown, unknown, Query, { input: Input } & Locals>;

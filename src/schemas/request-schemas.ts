import type { RequestHandler } from "express";
import type { ParamsDictionary, Query } from "express-serve-static-core";
import type { PublicUser } from "./user-schemas.js";

export type BodyParser<Input> = (body: unknown) => Input;

// Set by verifyToken.
export interface AuthenticatedLocals {
  user: PublicUser;
  sessionId: string;
}

// A handler mounted after validate(parser), and after verifyToken when Locals says so.
export type ValidatedHandler<Input, Locals extends object = object> =
  RequestHandler<ParamsDictionary, unknown, unknown, Query, { input: Input } & Locals>;

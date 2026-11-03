import type { Response } from "express";
import type { Auth } from "googleapis";

export interface GoogleAuthConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
}

export type VerifiedIdentityHandler = (identity: Auth.TokenPayload, res: Response) => Promise<void>;

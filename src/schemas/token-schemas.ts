export interface AccessTokenPayload {
  sub: string; // users.id
  sid: string; // sessions.id
}

export interface PasswordResetTokenPayload {
  sub: string; // users.id
  pwf: string; // fingerprint of the password hash the token was issued for
}

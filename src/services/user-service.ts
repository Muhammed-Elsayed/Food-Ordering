import { isUniqueViolation } from "../db/errors.js";
import { database, type Database } from "../db/index.js";
import type { NewSession, NewUser } from "../schemas/user-schemas.js";

// Fields that are safe to return to the account owner.
export const publicUserFields = {
  id: true, email: true, firstName: true, lastName: true, phone: true, phoneVerified: true, emailVerified: true,
} as const;

export class UserService {
  constructor(private readonly db: Database) {}

  findByGoogleSub(googleSub: string) {
    return this.db.client.user.findUnique({ where: { googleSub }, select: { id: true, isActive: true } });
  }

  findByEmail(email: string) {
    return this.db.client.user.findUnique({
      where: { email }, select: { id: true, isActive: true, passwordHash: true, googleSub: true },
    });
  }

  findPasswordAccount(id: string) {
    return this.db.client.user.findUnique({
      where: { id }, select: { email: true, isActive: true, passwordHash: true, googleSub: true },
    });
  }

  // Sets the new password and ends every other session; the one in keepSessionId stays.
  // Conditional on the old hash, so a parallel change or reset cannot both win.
  changePassword(userId: string, oldHash: string, newHash: string, keepSessionId: string) {
    return this.db.client.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, passwordHash: oldHash, isActive: true }, data: { passwordHash: newHash },
      });
      if (count === 0) return false;
      await tx.session.deleteMany({ where: { userId, id: { not: keepSessionId } } });
      return true;
    });
  }

  // Sets the new password, ends every session, and starts one for this device, all at once.
  // Conditional on the old hash, so a reset token works only once, even in parallel.
  // Returns null if the password already changed or the account was disabled.
  replacePassword(userId: string, oldHash: string, newHash: string, session: NewSession) {
    return this.db.client.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, passwordHash: oldHash, isActive: true },
        data: { passwordHash: newHash, emailVerified: true },
      });
      if (count === 0) return null;
      await tx.session.deleteMany({ where: { userId } });
      const { user } = await tx.session.create({
        data: { ...session, userId }, select: { user: { select: publicUserFields } },
      });
      return user;
    });
  }

  // Returns null if the email or Google account is already taken.
  async createWithSession(user: NewUser, session: NewSession) {
    try {
      return await this.db.client.user.create({
        data: { ...user, sessions: { create: session } }, select: publicUserFields,
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }
}

export const userService = new UserService(database);

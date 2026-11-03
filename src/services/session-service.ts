import { database, type Database } from "../db/index.js";
import type { NewSession } from "../schemas/user-schemas.js";
import { publicUserFields } from "./user-service.js";

export class SessionService {
  constructor(private readonly db: Database) {}

  // Also clears the user's expired sessions so they do not pile up.
  async create(userId: string, session: NewSession) {
    await this.db.client.session.deleteMany({ where: { userId, expiresAt: { lte: new Date() } } });
    const { user } = await this.db.client.session.create({
      data: { ...session, userId }, select: { user: { select: publicUserFields } },
    });
    return user;
  }

  async findActiveUser(sessionId: string, userId: string) {
    const session = await this.db.client.session.findFirst({
      where: { id: sessionId, userId, expiresAt: { gt: new Date() }, user: { isActive: true } },
      select: { user: { select: publicUserFields } },
    });
    return session?.user ?? null;
  }

  findByRefreshTokenHash(refreshTokenHash: string) {
    return this.db.client.session.findUnique({
      where: { refreshTokenHash },
      select: { id: true, userId: true, expiresAt: true, user: { select: { ...publicUserFields, isActive: true } } },
    });
  }

  // Conditional on the old hash, so only one of two parallel refreshes with the same token wins.
  async rotate(id: string, oldHash: string, next: Omit<NewSession, "id">) {
    const { count } = await this.db.client.session.updateMany({
      where: { id, refreshTokenHash: oldHash, expiresAt: { gt: new Date() } }, data: next,
    });
    return count === 1;
  }

  async deleteAllForUser(userId: string) {
    await this.db.client.session.deleteMany({ where: { userId } });
  }
}

export const sessionService = new SessionService(database);

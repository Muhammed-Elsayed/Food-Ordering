import { database, type Database } from "../db/index.js";
import type { NewPendingRegistration } from "../schemas/user-schemas.js";

export class PendingRegistrationService {
  constructor(private readonly db: Database) {}

  find(email: string) {
    return this.db.client.pendingRegistration.findUnique({ where: { email } });
  }

  // A new sign-up for the same email replaces the previous details.
  save(registration: NewPendingRegistration) {
    return this.db.client.pendingRegistration.upsert({
      where: { email: registration.email }, create: registration, update: registration,
    });
  }

  async delete(email: string) {
    await this.db.client.pendingRegistration.deleteMany({ where: { email } });
  }
}

export const pendingRegistrationService = new PendingRegistrationService(database);

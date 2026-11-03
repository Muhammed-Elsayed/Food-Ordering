import { PrismaPg } from "@prisma/adapter-pg";
import { databaseConfig } from "../config/index.js";
import { PrismaClient } from "./generated/prisma/client.js";

export class Database {
  private prisma?: PrismaClient;

  constructor(private readonly connectionString?: string) {}

  get client() {
    if (!this.connectionString) throw new Error("Set DATABASE_URL in .env first.");
    this.prisma ??= new PrismaClient({
      adapter: new PrismaPg({
        connectionString: this.connectionString,
        connectionTimeoutMillis: 5_000,
        max: 5,
      }),
    });
    return this.prisma;
  }

  async connect() {
    await this.client.$connect();
    await this.client.$queryRaw`SELECT 1`;
  }

  async disconnect() {
    await this.prisma?.$disconnect();
  }
}

export const database = new Database(databaseConfig.url);

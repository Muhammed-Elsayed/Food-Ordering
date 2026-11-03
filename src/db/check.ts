import { database } from "./index.js";

async function check() {
  try {
    await database.connect();
    const count = await database.client.user.count();
    console.log(`PostgreSQL connected. Users table ready (${count} accounts).`);
  } catch {
    console.error("Database check failed. Check DATABASE_URL, start PostgreSQL, and apply migrations.");
    process.exitCode = 1;
  } finally {
    await database.disconnect();
  }
}

void check();

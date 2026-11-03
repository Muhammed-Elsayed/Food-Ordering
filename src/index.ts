import { createApp } from "./app.js";
import { port } from "./config/index.js";
import { database } from "./db/index.js";

const app = createApp();

async function start() {
  try {
    await database.connect();
    const server = app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
    const shutdown = () => {
      server.close(() => { void database.disconnect(); });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch {
    console.error("Could not connect to PostgreSQL. Start the database and check DATABASE_URL.");
    await database.disconnect();
    process.exitCode = 1;
  }
}

void start();

import { rm } from "node:fs/promises";

export default async function globalTeardown() {
  const databasePath = process.env.E2E_ACTIVE_DB_PATH;
  if (!databasePath) return;

  await Promise.all([
    rm(databasePath, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
    rm(`${databasePath}-wal`, { force: true }),
  ]);
}

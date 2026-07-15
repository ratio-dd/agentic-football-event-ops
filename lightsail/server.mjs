import { createServer } from "node:http";
import { Readable } from "node:stream";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeAssets } from "./assets.mjs";
import { SqliteD1 } from "./sqlite-d1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const { default: worker } = await import("./runtime/worker.mjs");
const port = Number(process.env.PORT || 8787);
const dbPath = process.env.EVENT_DB_PATH || resolve(root, ".local-data", "event.db");
const db = new SqliteD1(dbPath);
const env = {
  ASSETS: makeAssets(resolve(root, "public")),
  DB: db,
  STAFF_PINS: process.env.STAFF_PINS,
  ADMIN_PIN: process.env.ADMIN_PIN,
};

const server = createServer(async (incoming, outgoing) => {
  try {
    const protocol = incoming.headers["x-forwarded-proto"] || "http";
    const host = incoming.headers.host || "localhost";
    const method = incoming.method || "GET";
    const request = new Request(new URL(incoming.url || "/", `${protocol}://${host}`), {
      method,
      headers: incoming.headers,
      body: ["GET", "HEAD"].includes(method) ? undefined : Readable.toWeb(incoming),
      duplex: "half",
    });
    const response = await worker.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
    else outgoing.end();
  } catch {
    outgoing.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ error: "服务暂时不可用" }));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Agentic Football event ops is listening on :${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}

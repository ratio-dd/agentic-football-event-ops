import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The current Worker only needs D1's prepare/bind/first/run surface. Keeping
 * this deliberately small lets the business rules remain shared between D1
 * and a Lightsail-hosted SQLite database.
 */
export class SqliteD1 {
  constructor(filename) {
    const path = resolve(filename);
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  }

  prepare(sql) {
    const statement = this.database.prepare(sql);
    return new SqliteStatement(statement);
  }

  close() {
    this.database.close();
  }
}

class SqliteStatement {
  constructor(statement) {
    this.statement = statement;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    return this.statement.get(...this.values) ?? null;
  }

  async all() {
    return this.statement.all(...this.values);
  }

  async run() {
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes ?? 0) } };
  }
}

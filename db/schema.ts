import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** One durable, versioned event document.  The API applies all event rules. */
export const eventState = sqliteTable("event_state", {
  id: text("id").primaryKey(),
  data: text("data").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

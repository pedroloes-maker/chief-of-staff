import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Placeholder mínimo do SMA-6. O sync com Clerk vem no SMA-7,
// quando tivermos JWT verification no backend.
export const users = pgTable("users", {
  id: text("id").primaryKey(), // = clerk_user_id
  email: text("email").notNull().unique(),
  name: text("name"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

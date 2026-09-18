import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

type TaxLine = { rate: number; netCents: number; taxCents: number };

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["invoice", "expense"] }).notNull(),
  number: text("number").notNull(),
  party: text("party").notNull(),
  concept: text("concept").notNull(),
  issueDate: text("issue_date").notNull(),
  dueDate: text("due_date"),
  paymentDate: text("payment_date"),
  paymentMethod: text("payment_method"),
  netCents: integer("net_cents").notNull(),
  taxCents: integer("tax_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  taxRate: integer("tax_rate").notNull(),
  taxBreakdown: text("tax_breakdown", { mode: "json" }).$type<TaxLine[]>().notNull().default(sql`'[]'`),
  status: text("status", { enum: ["paid", "pending", "overdue", "draft"] }).notNull(),
  fileKey: text("file_key"),
  fileName: text("file_name"),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

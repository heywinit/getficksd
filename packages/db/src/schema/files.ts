import { relations } from "drizzle-orm";
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

export const storedFile = pgTable(
  "stored_file",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull().unique(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    status: text("status").default("pending").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    uploadedAt: timestamp("uploaded_at"),
  },
  (table) => [
    index("storedFile_organizationId_idx").on(table.organizationId),
    index("storedFile_uploadedBy_idx").on(table.uploadedBy),
  ],
);

export const storedFileRelations = relations(storedFile, ({ one }) => ({
  organization: one(organization, {
    fields: [storedFile.organizationId],
    references: [organization.id],
  }),
  uploader: one(user, {
    fields: [storedFile.uploadedBy],
    references: [user.id],
  }),
}));

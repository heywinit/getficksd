import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { storedFile } from "./files";

export type DatasetColumnType = "string" | "number" | "boolean" | "date";

export type DatasetColumn = {
  source: string;
  target: string;
  type: DatasetColumnType;
  required: boolean;
};

export type DatasetValidationError = {
  row: number;
  column: string;
  message: string;
};

export const dataset = pgTable(
  "dataset",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceFileId: text("source_file_id").references(() => storedFile.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    columns: jsonb("columns").$type<DatasetColumn[]>().notNull(),
    rowCount: integer("row_count").notNull(),
    errorCount: integer("error_count").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("dataset_organizationId_idx").on(table.organizationId),
    index("dataset_createdBy_idx").on(table.createdBy),
  ],
);

export const datasetRow = pgTable(
  "dataset_row",
  {
    id: text("id").primaryKey(),
    datasetId: text("dataset_id")
      .notNull()
      .references(() => dataset.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    errors: jsonb("errors").$type<DatasetValidationError[]>().notNull(),
  },
  (table) => [
    index("datasetRow_datasetId_idx").on(table.datasetId),
    uniqueIndex("datasetRow_datasetId_rowNumber_uidx").on(table.datasetId, table.rowNumber),
  ],
);

export const datasetRelations = relations(dataset, ({ one, many }) => ({
  organization: one(organization, {
    fields: [dataset.organizationId],
    references: [organization.id],
  }),
  creator: one(user, {
    fields: [dataset.createdBy],
    references: [user.id],
  }),
  sourceFile: one(storedFile, {
    fields: [dataset.sourceFileId],
    references: [storedFile.id],
  }),
  rows: many(datasetRow),
}));

export const datasetRowRelations = relations(datasetRow, ({ one }) => ({
  dataset: one(dataset, {
    fields: [datasetRow.datasetId],
    references: [dataset.id],
  }),
}));

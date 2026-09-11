import { createDb } from "@getficksd/db";
import { dataset, datasetRow } from "@getficksd/db/schema/datasets";
import { storedFile } from "@getficksd/db/schema/files";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, router } from "../index";

const columnSchema = z.object({
  source: z.string().min(1),
  target: z.string().trim().min(1),
  type: z.enum(["string", "number", "boolean", "date"]),
  required: z.boolean(),
});

const rowSchema = z.record(z.string(), z.unknown());

function activeWorkspaceId(session: { session: { activeOrganizationId?: string | null } }) {
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    throw new Error("Select a workspace before you load a dataset.");
  }
  return organizationId;
}

export const datasetsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = activeWorkspaceId(ctx.session);
    const db = createDb();

    return db.query.dataset.findMany({
      where: eq(dataset.organizationId, organizationId),
      orderBy: desc(dataset.createdAt),
    });
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const organizationId = activeWorkspaceId(ctx.session);
      const db = createDb();
      const item = await db.query.dataset.findFirst({
        where: and(eq(dataset.id, input.id), eq(dataset.organizationId, organizationId)),
      });

      if (!item) {
        throw new Error("Dataset not found.");
      }

      const rows = await db
        .select()
        .from(datasetRow)
        .where(eq(datasetRow.datasetId, item.id))
        .orderBy(asc(datasetRow.rowNumber))
        .limit(100);

      return { ...item, rows };
    }),

  load: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1),
        sourceFileId: z.string().min(1).optional(),
        columns: z.array(columnSchema).min(1),
        rows: z.array(rowSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = activeWorkspaceId(ctx.session);
      const db = createDb();
      const duplicateTargets = input.columns.filter(
        (column, index) =>
          input.columns.findIndex((candidate) => candidate.target === column.target) !== index,
      );

      if (duplicateTargets.length) {
        throw new Error("Mapped column names must be unique.");
      }

      if (input.sourceFileId) {
        const file = await db.query.storedFile.findFirst({
          where: and(
            eq(storedFile.id, input.sourceFileId),
            eq(storedFile.organizationId, organizationId),
          ),
        });
        if (!file) {
          throw new Error("Source file not found.");
        }
      }

      const normalizedRows = input.rows.map((row, index) =>
        normalizeRow(row, input.columns, index),
      );
      const errorCount = normalizedRows.reduce((count, row) => count + row.errors.length, 0);
      const id = crypto.randomUUID();

      await db.transaction(async (tx) => {
        await tx.insert(dataset).values({
          id,
          organizationId,
          createdBy: ctx.session.user.id,
          sourceFileId: input.sourceFileId,
          name: input.name,
          columns: input.columns,
          rowCount: normalizedRows.length,
          errorCount,
        });

        for (let offset = 0; offset < normalizedRows.length; offset += 500) {
          const chunk = normalizedRows.slice(offset, offset + 500);
          if (chunk.length) {
            await tx.insert(datasetRow).values(
              chunk.map((row, chunkIndex) => ({
                id: crypto.randomUUID(),
                datasetId: id,
                rowNumber: offset + chunkIndex + 1,
                data: row.data,
                errors: row.errors,
              })),
            );
          }
        }
      });

      return { id, rowCount: normalizedRows.length, errorCount };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = activeWorkspaceId(ctx.session);
      const db = createDb();
      const [removed] = await db
        .delete(dataset)
        .where(and(eq(dataset.id, input.id), eq(dataset.organizationId, organizationId)))
        .returning({ id: dataset.id });

      return { removed: Boolean(removed) };
    }),
});

type Column = z.infer<typeof columnSchema>;

function normalizeRow(row: Record<string, unknown>, columns: Column[], rowIndex: number) {
  const data: Record<string, unknown> = {};
  const errors: Array<{ row: number; column: string; message: string }> = [];

  for (const column of columns) {
    const value = row[column.source];
    const isEmpty = value === null || value === undefined || value === "";

    if (isEmpty) {
      data[column.target] = null;
      if (column.required) {
        errors.push({
          row: rowIndex + 1,
          column: column.target,
          message: `${column.target} is required.`,
        });
      }
      continue;
    }

    const normalized = coerceValue(value, column.type);
    data[column.target] = normalized.value;
    if (normalized.error) {
      errors.push({ row: rowIndex + 1, column: column.target, message: normalized.error });
    }
  }

  return { data, errors };
}

function coerceValue(value: unknown, type: Column["type"]) {
  if (type === "string") {
    return {
      value: typeof value === "object" ? JSON.stringify(value) : String(value),
    };
  }

  if (type === "number") {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number)
      ? { value: number }
      : { value, error: `Expected a number, received ${String(value)}.` };
  }

  if (type === "boolean") {
    const normalized = String(value).toLowerCase().trim();
    if (["true", "1", "yes"].includes(normalized)) {
      return { value: true };
    }
    if (["false", "0", "no"].includes(normalized)) {
      return { value: false };
    }
    return { value, error: `Expected a boolean, received ${String(value)}.` };
  }

  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? { value, error: `Expected a date, received ${String(value)}.` }
    : { value: date.toISOString() };
}

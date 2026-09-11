import { createDb } from "@getficksd/db";
import { storedFile } from "@getficksd/db/schema/files";
import {
  createDownloadUrl,
  createObjectKey,
  createUploadUrl,
  deleteObject,
} from "@getficksd/storage";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, router } from "../index";

function activeWorkspaceId(session: { session: { activeOrganizationId?: string | null } }) {
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    throw new Error("Select a workspace before you upload a file.");
  }
  return organizationId;
}

export const filesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = activeWorkspaceId(ctx.session);
    const db = createDb();

    return db.query.storedFile.findMany({
      where: eq(storedFile.organizationId, organizationId),
      orderBy: desc(storedFile.createdAt),
    });
  }),

  createUpload: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1),
        contentType: z.string().trim().min(1),
        size: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = activeWorkspaceId(ctx.session);
      const id = crypto.randomUUID();
      const objectKey = createObjectKey(organizationId, input.name);
      const db = createDb();

      await db.insert(storedFile).values({
        id,
        organizationId,
        uploadedBy: ctx.session.user.id,
        objectKey,
        name: input.name,
        contentType: input.contentType,
        size: input.size,
      });

      return {
        id,
        objectKey,
        uploadUrl: await createUploadUrl(objectKey, input.contentType),
      };
    }),

  completeUpload: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = activeWorkspaceId(ctx.session);
      const db = createDb();

      const [file] = await db
        .update(storedFile)
        .set({ status: "ready", uploadedAt: new Date() })
        .where(and(eq(storedFile.id, input.id), eq(storedFile.organizationId, organizationId)))
        .returning();

      return file;
    }),

  download: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const organizationId = activeWorkspaceId(ctx.session);
      const db = createDb();
      const file = await db.query.storedFile.findFirst({
        where: and(eq(storedFile.id, input.id), eq(storedFile.organizationId, organizationId)),
      });

      if (!file) {
        throw new Error("File not found.");
      }

      return { url: await createDownloadUrl(file.objectKey) };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = activeWorkspaceId(ctx.session);
      const db = createDb();
      const file = await db.query.storedFile.findFirst({
        where: and(eq(storedFile.id, input.id), eq(storedFile.organizationId, organizationId)),
      });

      if (!file) {
        return { removed: false };
      }

      await deleteObject(file.objectKey);
      await db.delete(storedFile).where(eq(storedFile.id, file.id));
      return { removed: true };
    }),
});

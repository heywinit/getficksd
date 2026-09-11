import { createDb } from "@getficksd/db";
import * as schema from "@getficksd/db/schema/auth";
import { env } from "@getficksd/env/server";
import { sendMail } from "@getficksd/mail";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { asc, eq } from "drizzle-orm";

function workspaceSlug(name: string, userId: string) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);

  return `${base || "workspace"}-${userId.slice(0, 6).toLowerCase()}`;
}

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",

      schema: schema,
    }),
    trustedOrigins: [env.BETTER_AUTH_URL],
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const existingMembership = await db.query.member.findFirst({
              where: eq(schema.member.userId, user.id),
            });

            if (existingMembership) {
              return;
            }

            const organizationId = crypto.randomUUID();

            await db.transaction(async (transaction) => {
              await transaction.insert(schema.organization).values({
                id: organizationId,
                name: `${user.name}'s Workspace`,
                slug: workspaceSlug(user.name, user.id),
              });
              await transaction.insert(schema.member).values({
                id: crypto.randomUUID(),
                organizationId,
                userId: user.id,
                role: "owner",
              });
            });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const membership = await db.query.member.findFirst({
              where: eq(schema.member.userId, session.userId),
              orderBy: asc(schema.member.createdAt),
            });

            return {
              data: {
                ...session,
                activeOrganizationId: membership?.organizationId,
              },
            };
          },
        },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
        sendInvitationEmail: async ({ email, id, inviter, organization: workspace }) => {
          const invitationUrl = new URL("/members", env.BETTER_AUTH_URL);
          invitationUrl.searchParams.set("invitation", id);

          await sendMail({
            to: email,
            subject: `Join ${workspace.name}`,
            text: `${inviter.user.name} invited you to join ${workspace.name}. Accept the invitation: ${invitationUrl.toString()}`,
            html: `<p>${escapeHtml(inviter.user.name)} invited you to join <strong>${escapeHtml(workspace.name)}</strong>.</p><p><a href="${invitationUrl.toString()}">Accept invitation</a></p>`,
          });
        },
      }),
      tanstackStartCookies(),
    ],
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

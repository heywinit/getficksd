import { and, asc, eq } from "drizzle-orm";

import { member, user } from "../schema/auth";
import { dataset, datasetRow } from "../schema/datasets";
import { scriptDb, sql } from "./client";

async function seed() {
  const requestedEmail = process.argv
    .find((argument) => argument.startsWith("--email="))
    ?.slice("--email=".length);
  const owner = requestedEmail
    ? await scriptDb.query.user.findFirst({ where: eq(user.email, requestedEmail) })
    : await scriptDb.query.user.findFirst({ orderBy: asc(user.createdAt) });

  if (!owner) {
    throw new Error("Create an account first, then run the seed command again.");
  }

  const membership = await scriptDb.query.member.findFirst({
    where: eq(member.userId, owner.id),
    orderBy: asc(member.createdAt),
  });
  if (!membership) {
    throw new Error(`No workspace exists for ${owner.email}.`);
  }

  const existing = await scriptDb.query.dataset.findFirst({
    where: and(
      eq(dataset.organizationId, membership.organizationId),
      eq(dataset.name, "Hackout sample metrics"),
    ),
  });
  if (existing) {
    console.log(`Seed data already exists for ${owner.email}.`);
    return;
  }

  const datasetId = crypto.randomUUID();
  const rows = [
    { region: "Ahmedabad", score: 74, active: true },
    { region: "Gandhinagar", score: 88, active: true },
    { region: "Rajkot", score: 63, active: false },
    { region: "Surat", score: 91, active: true },
    { region: "Vadodara", score: 82, active: true },
  ];

  await scriptDb.transaction(async (transaction) => {
    await transaction.insert(dataset).values({
      id: datasetId,
      organizationId: membership.organizationId,
      createdBy: owner.id,
      name: "Hackout sample metrics",
      columns: [
        { source: "region", target: "region", type: "string", required: true },
        { source: "score", target: "score", type: "number", required: true },
        { source: "active", target: "active", type: "boolean", required: false },
      ],
      rowCount: rows.length,
      errorCount: 0,
    });
    await transaction.insert(datasetRow).values(
      rows.map((data, index) => ({
        id: crypto.randomUUID(),
        datasetId,
        rowNumber: index + 1,
        data,
        errors: [],
      })),
    );
  });

  console.log(`Seeded sample data for ${owner.email}.`);
}

seed()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());

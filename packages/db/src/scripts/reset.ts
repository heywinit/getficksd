import { organization, user, verification } from "../schema/auth";
import { scriptDb, sql } from "./client";

async function reset() {
  if (!process.argv.includes("--yes")) {
    throw new Error("Reset deletes all application data. Run it again with --yes to continue.");
  }

  await scriptDb.transaction(async (transaction) => {
    await transaction.delete(organization);
    await transaction.delete(user);
    await transaction.delete(verification);
  });

  console.log("Database data reset complete. The schema and migrations were kept.");
}

reset()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());

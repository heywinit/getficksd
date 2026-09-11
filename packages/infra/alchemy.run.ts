import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { config } from "dotenv";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });

function optionalSecret(name: string) {
  return Config.redacted(name).pipe(Config.orElse(() => Config.succeed(Redacted.make(""))));
}

function postgresConnection(urlValue: Redacted.Redacted<string>) {
  const url = new URL(Redacted.value(urlValue));

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  const origin = {
    scheme: url.protocol.slice(0, -1) as "postgres" | "postgresql",
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: Redacted.make(decodeURIComponent(url.password)),
  };
  const localHost = origin.host === "localhost" || origin.host === "127.0.0.1";

  return {
    origin,
    caching: { disabled: true },
    dev: {
      ...origin,
      sslmode: localHost ? ("disable" as const) : ("require" as const),
    },
  };
}

const database = Cloudflare.Hyperdrive.Connection(
  "database",
  Config.redacted("DATABASE_URL").pipe(Config.map(postgresConnection), Effect.orDie),
);

export const web = Cloudflare.Website.Vite("web", {
  rootDir: "../../apps/web",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  env: {
    HYPERDRIVE: database,
    BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: Cloudflare.Worker.URL,
    GOOGLE_CLIENT_ID: Config.redacted("GOOGLE_CLIENT_ID"),
    GOOGLE_CLIENT_SECRET: Config.redacted("GOOGLE_CLIENT_SECRET"),
    S3_ENDPOINT: Config.redacted("S3_ENDPOINT"),
    S3_REGION: Config.redacted("S3_REGION"),
    S3_BUCKET: Config.redacted("S3_BUCKET"),
    S3_ACCESS_KEY_ID: Config.redacted("S3_ACCESS_KEY_ID"),
    S3_SECRET_ACCESS_KEY: Config.redacted("S3_SECRET_ACCESS_KEY"),
    SMTP_HOST: Config.redacted("SMTP_HOST"),
    SMTP_PORT: Config.redacted("SMTP_PORT"),
    SMTP_SECURE: Config.redacted("SMTP_SECURE"),
    SMTP_USER: optionalSecret("SMTP_USER"),
    SMTP_PASSWORD: optionalSecret("SMTP_PASSWORD"),
    SMTP_FROM: Config.redacted("SMTP_FROM"),
  },
  dev: {
    port: 3001,
  },
});

export type WebEnv = Cloudflare.InferEnv<typeof web>;

export default Alchemy.Stack(
  "getficksd",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const webWorker = yield* web;

    return {
      web: webWorker.url,
    };
  }),
);

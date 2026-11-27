#!/usr/bin/env node
// Registers and manages OAuth clients (apps such as Muse) that may ask to connect to a ledger.
// There is no open registration endpoint: an operator runs this against the app's database.
//
//   node scripts/oauth-client.mjs create --name Muse --redirect-uri https://muse.example/callback [--scopes ledger:read,ledger:draft]
//   node scripts/oauth-client.mjs rotate-secret --client-id syr_client_…
//   node scripts/oauth-client.mjs add-redirect --client-id syr_client_… --redirect-uri https://…
//   node scripts/oauth-client.mjs set-scopes --client-id syr_client_… --scopes ledger:read,ledger:draft,ledger:write
//   node scripts/oauth-client.mjs disable --client-id syr_client_…
//   node scripts/oauth-client.mjs list
//
// The client secret is printed once and only its SHA-256 hash is stored.
import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import pg from "pg";

const SCOPES = new Set(["ledger:read", "ledger:draft", "ledger:write"]);
const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({ args: rest, options: { name: { type: "string" }, "redirect-uri": { type: "string" }, scopes: { type: "string" }, "client-id": { type: "string" } } });

const hash = (value) => createHash("sha256").update(value).digest("hex");
const secret = () => `syr_cs_${randomBytes(32).toString("base64url")}`;
function fail(message) { console.error(message); process.exit(1); }
function checkRedirect(value) {
  let url;
  try { url = new URL(value); } catch { fail(`Not a URL: ${value}`); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) fail("Redirect URIs must use https (http only for localhost).");
  if (url.hash) fail("Redirect URIs cannot contain a fragment.");
  return url.toString();
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) fail("Set DATABASE_URL to the app's database.");
console.error(`Database host: ${new URL(connectionString).hostname || "(local socket)"}`);
const db = new pg.Client({ connectionString });
await db.connect();
try {
  if (command === "create") {
    if (!values.name || !values["redirect-uri"]) fail("create needs --name and --redirect-uri.");
    const scopes = (values.scopes ?? "ledger:read,ledger:draft").split(",").map((scope) => scope.trim()).filter(Boolean);
    if (scopes.some((scope) => !SCOPES.has(scope))) fail(`Scopes must be from: ${[...SCOPES].join(", ")}`);
    const clientId = `syr_client_${randomBytes(12).toString("base64url")}`;
    const clientSecret = secret();
    await db.query(
      `INSERT INTO "OAuthClient" ("id", "clientId", "name", "clientSecretHash", "redirectUris", "scopes", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [randomUUID(), clientId, values.name, hash(clientSecret), [checkRedirect(values["redirect-uri"])], scopes],
    );
    console.log(JSON.stringify({ client_id: clientId, client_secret: clientSecret, scopes }, null, 2));
    console.error("Store the secret in the app's secret store now. It is not shown again.");
  } else if (command === "rotate-secret") {
    if (!values["client-id"]) fail("rotate-secret needs --client-id.");
    const clientSecret = secret();
    const { rowCount } = await db.query(`UPDATE "OAuthClient" SET "clientSecretHash" = $1, "updatedAt" = now() WHERE "clientId" = $2`, [hash(clientSecret), values["client-id"]]);
    if (!rowCount) fail("No such client.");
    console.log(JSON.stringify({ client_id: values["client-id"], client_secret: clientSecret }, null, 2));
  } else if (command === "add-redirect") {
    if (!values["client-id"] || !values["redirect-uri"]) fail("add-redirect needs --client-id and --redirect-uri.");
    const { rowCount } = await db.query(`UPDATE "OAuthClient" SET "redirectUris" = array_append("redirectUris", $1), "updatedAt" = now() WHERE "clientId" = $2 AND NOT ($1 = ANY("redirectUris"))`, [checkRedirect(values["redirect-uri"]), values["client-id"]]);
    console.log(rowCount ? "Added." : "No change (unknown client or already listed).");
  } else if (command === "set-scopes") {
    // Takes effect at the next consent: tokens already issued keep the scopes the user approved.
    if (!values["client-id"] || !values.scopes) fail("set-scopes needs --client-id and --scopes.");
    const scopes = values.scopes.split(",").map((scope) => scope.trim()).filter(Boolean);
    if (!scopes.length || scopes.some((scope) => !SCOPES.has(scope))) fail(`Scopes must be from: ${[...SCOPES].join(", ")}`);
    const { rowCount } = await db.query(`UPDATE "OAuthClient" SET "scopes" = $1, "updatedAt" = now() WHERE "clientId" = $2`, [scopes, values["client-id"]]);
    console.log(rowCount ? `Scopes set to ${scopes.join(", ")}. The user approves them the next time the app connects.` : "No such client.");
  } else if (command === "disable") {
    if (!values["client-id"]) fail("disable needs --client-id.");
    const { rowCount } = await db.query(`UPDATE "OAuthClient" SET "disabled" = true, "updatedAt" = now() WHERE "clientId" = $1`, [values["client-id"]]);
    console.log(rowCount ? "Disabled. Its tokens stop working immediately." : "No such client.");
  } else if (command === "list") {
    const { rows } = await db.query(`SELECT "clientId", "name", "redirectUris", "scopes", "disabled", "createdAt" FROM "OAuthClient" ORDER BY "createdAt"`);
    console.log(JSON.stringify(rows, null, 2));
  } else {
    fail("Commands: create, rotate-secret, add-redirect, set-scopes, disable, list");
  }
} finally {
  await db.end();
}

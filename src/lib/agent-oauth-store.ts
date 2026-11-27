import type { PrismaClient } from "../generated/prisma/client";
import {
  ACCESS_TOKEN_TTL_SECONDS, CODE_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, hashSecret, IGNORED_SCOPES, isAgentScope, newSecret, pkceMatches, secretMatches,
  type AgentScope, type AuthorizeRequest,
} from "./agent-oauth";

type Db = PrismaClient;

export class OAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export async function findClient(db: Db, clientId: string) {
  return db.oAuthClient.findUnique({ where: { clientId }, select: { id: true, clientId: true, name: true, redirectUris: true, scopes: true, disabled: true, clientSecretHash: true } });
}

/** Confirms a confidential client's secret. Unknown clients and wrong secrets fail the same way. */
export async function authenticateClient(db: Db, credentials: { clientId: string; clientSecret: string } | null) {
  const client = credentials ? await findClient(db, credentials.clientId) : null;
  if (!client || client.disabled || !credentials || !secretMatches(credentials.clientSecret, client.clientSecretHash)) {
    throw new OAuthError("invalid_client", "Client authentication failed.", 401);
  }
  return client;
}

/** Records the user's approval and returns a one-time code for the client. */
export async function approveAuthorization(db: Db, userId: string, request: AuthorizeRequest) {
  const code = newSecret("syr_code");
  await db.$transaction(async (tx) => {
    const grant = await tx.oAuthGrant.upsert({
      where: { userId_clientId: { userId, clientId: request.client.id } },
      create: { userId, clientId: request.client.id, scopes: request.scopes },
      update: { scopes: request.scopes, revokedAt: null },
      select: { id: true },
    });
    await tx.oAuthCode.create({
      data: {
        codeHash: hashSecret(code), grantId: grant.id, redirectUri: request.redirectUri, codeChallenge: request.codeChallenge,
        scopes: request.scopes, resource: request.resource, expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
      },
    });
  });
  return code;
}

async function issueTokens(tx: Parameters<Parameters<Db["$transaction"]>[0]>[0], grantId: string, scopes: string[], resource: string): Promise<TokenResponse> {
  const accessToken = newSecret("syr_at");
  const refreshToken = newSecret("syr_rt");
  const now = Date.now();
  await tx.oAuthToken.create({
    data: {
      grantId, scopes, resource, accessTokenHash: hashSecret(accessToken), refreshTokenHash: hashSecret(refreshToken),
      accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000), refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  });
  return { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refreshToken, scope: scopes.join(" ") };
}

export async function exchangeCode(db: Db, clientId: string, input: { code: string; redirectUri: string; codeVerifier: string; resource: string | null }) {
  const outcome = await db.$transaction(async (tx) => {
    const code = await tx.oAuthCode.findUnique({ where: { codeHash: hashSecret(input.code) }, include: { grant: { select: { id: true, clientId: true, revokedAt: true } } } });
    if (!code || code.grant.clientId !== clientId) return { error: new OAuthError("invalid_grant", "The authorization code is not valid.") };
    // A replayed code means it leaked: revoke the tokens it produced (RFC 6749 §4.1.2).
    if (code.usedAt) {
      await tx.oAuthToken.updateMany({ where: { grantId: code.grantId, createdAt: { gte: code.createdAt }, revokedAt: null }, data: { revokedAt: new Date() } });
      return { error: new OAuthError("invalid_grant", "The authorization code was already used.") };
    }
    const claimed = await tx.oAuthCode.updateMany({ where: { id: code.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) return { error: new OAuthError("invalid_grant", "The authorization code was already used.") };
    if (code.expiresAt < new Date() || code.grant.revokedAt) return { error: new OAuthError("invalid_grant", "The authorization code has expired.") };
    if (code.redirectUri !== input.redirectUri) return { error: new OAuthError("invalid_grant", "redirect_uri does not match the authorization request.") };
    if (!pkceMatches(input.codeVerifier, code.codeChallenge)) return { error: new OAuthError("invalid_grant", "PKCE verification failed.") };
    if (input.resource && input.resource !== code.resource) return { error: new OAuthError("invalid_target", "Unknown resource.") };
    return { tokens: await issueTokens(tx, code.grantId, code.scopes, code.resource) };
  });
  // Failed checks still commit the code's use and any revocation, so errors leave the transaction as values.
  if ("error" in outcome && outcome.error) throw outcome.error;
  return outcome.tokens!;
}

/** Rotates a refresh token. Presenting one that was already rotated revokes the grant, since only a thief would still hold it. */
export async function refreshTokens(db: Db, clientId: string, input: { refreshToken: string; scope: string | null }) {
  const outcome = await db.$transaction(async (tx) => {
    const token = await tx.oAuthToken.findUnique({ where: { refreshTokenHash: hashSecret(input.refreshToken) }, include: { grant: { select: { id: true, clientId: true, revokedAt: true, scopes: true } } } });
    if (!token || token.grant.clientId !== clientId) return { error: new OAuthError("invalid_grant", "The refresh token is not valid.") };
    if (token.rotatedAt) {
      const now = new Date();
      await tx.oAuthGrant.update({ where: { id: token.grantId }, data: { revokedAt: now } });
      await tx.oAuthToken.updateMany({ where: { grantId: token.grantId, revokedAt: null }, data: { revokedAt: now } });
      return { error: new OAuthError("invalid_grant", "The refresh token was already used. Reconnect the app.") };
    }
    if (token.revokedAt || token.grant.revokedAt || token.refreshExpiresAt < new Date()) return { error: new OAuthError("invalid_grant", "The refresh token has expired or was revoked.") };
    // A refresh may narrow scope, never widen it, and never past what the user still allows.
    const current = token.scopes.filter((scope) => token.grant.scopes.includes(scope));
    const asked = (input.scope ?? "").split(/\s+/).filter((word) => word && !IGNORED_SCOPES.has(word));
    const wanted = asked.length ? asked : current;
    if (wanted.some((scope) => !current.includes(scope))) return { error: new OAuthError("invalid_scope", "A refresh cannot add scopes.") };
    const claimed = await tx.oAuthToken.updateMany({ where: { id: token.id, rotatedAt: null }, data: { rotatedAt: new Date(), revokedAt: new Date() } });
    if (claimed.count !== 1) return { error: new OAuthError("invalid_grant", "The refresh token was already used.") };
    return { tokens: await issueTokens(tx, token.grantId, wanted, token.resource) };
  });
  // Reuse detection must commit its revocation, so errors are returned out of the transaction and thrown here.
  if ("error" in outcome && outcome.error) throw outcome.error;
  return outcome.tokens!;
}

/** RFC 7009: revokes the token's whole grant chain for refresh tokens, or just the access token. Unknown tokens succeed silently. */
export async function revokeToken(db: Db, clientId: string, value: string) {
  const hash = hashSecret(value);
  const token = await db.oAuthToken.findFirst({ where: { OR: [{ accessTokenHash: hash }, { refreshTokenHash: hash }] }, select: { id: true, refreshTokenHash: true, grant: { select: { clientId: true } } } });
  if (!token || token.grant.clientId !== clientId) return;
  await db.oAuthToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
}

export interface AgentPrincipal {
  userId: string;
  grantId: string;
  clientName: string;
  scopes: AgentScope[];
}

const LAST_USED_GRANULARITY_MS = 5 * 60 * 1000;

/** Resolves a bearer access token for the MCP resource, or null when it is unknown, expired, revoked or for another resource. */
export async function authenticateAccessToken(db: Db, accessToken: string, resource: string): Promise<AgentPrincipal | null> {
  const token = await db.oAuthToken.findUnique({
    where: { accessTokenHash: hashSecret(accessToken) },
    select: { scopes: true, resource: true, accessExpiresAt: true, revokedAt: true, grant: { select: { id: true, userId: true, scopes: true, revokedAt: true, lastUsedAt: true, client: { select: { name: true, disabled: true } } } } },
  });
  if (!token || token.revokedAt || token.accessExpiresAt < new Date() || token.resource !== resource) return null;
  if (token.grant.revokedAt || token.grant.client.disabled) return null;
  if (!token.grant.lastUsedAt || Date.now() - token.grant.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
    await db.oAuthGrant.update({ where: { id: token.grant.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return {
    userId: token.grant.userId,
    grantId: token.grant.id,
    clientName: token.grant.client.name,
    scopes: token.scopes.filter((scope): scope is AgentScope => isAgentScope(scope) && token.grant.scopes.includes(scope)),
  };
}

export async function listConnections(db: Db, userId: string) {
  const grants = await db.oAuthGrant.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, scopes: true, createdAt: true, lastUsedAt: true, client: { select: { name: true } } },
  });
  return grants.map((grant) => ({ id: grant.id, name: grant.client.name, scopes: grant.scopes, connectedAt: grant.createdAt.toISOString(), lastUsedAt: grant.lastUsedAt?.toISOString() ?? null }));
}

export async function revokeConnection(db: Db, userId: string, grantId: string) {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const updated = await tx.oAuthGrant.updateMany({ where: { id: grantId, userId, revokedAt: null }, data: { revokedAt: now } });
    if (updated.count === 0) return null;
    await tx.oAuthToken.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: now } });
    const grant = await tx.oAuthGrant.findUniqueOrThrow({ where: { id: grantId }, select: { client: { select: { name: true } } } });
    return grant.client.name;
  });
}

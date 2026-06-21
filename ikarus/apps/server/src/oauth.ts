import type http from "node:http";
import { randomBytes } from "node:crypto";
import {
  discoverOAuthProtectedResourceMetadata,
  discoverAuthorizationServerMetadata,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpConnection } from "@prisma/client";
import { db } from "./db.js";
import { encryptSecret, last4 } from "./crypto.js";

/**
 * MCP OAuth 2.1 (authorization-code + PKCE) client for upstream connections that
 * require it (per the MCP Authorization spec). The browser is redirected to the
 * upstream's authorization server; on callback we exchange the code for a token
 * and store it (encrypted) as the connection's credential. The gateway then sends
 * it as `Authorization: Bearer <token>` like any other credential.
 */

const CALLBACK_PATH = "/oauth/callback";
const FLOW_TTL_MS = 10 * 60 * 1000;

/** The public base the upstream redirects back to (must reach THIS server). */
function callbackUrl(): string {
  const base = process.env.OAUTH_PUBLIC_BASE ?? `http://localhost:${process.env.PORT ?? 8787}`;
  return base.replace(/\/$/, "") + CALLBACK_PATH;
}

/** Where to send the browser after the callback finishes (the SPA). */
function webOrigin(): string {
  return (process.env.WEB_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");
}

interface PendingFlow {
  userId: string;
  connectionId: string;
  authServerUrl: string;
  asMetadata: AuthorizationServerMetadata;
  clientInfo: OAuthClientInformationFull;
  codeVerifier: string;
  redirectUrl: string;
  resource?: string;
  expires: number;
}

// In-process store of in-flight authorizations, keyed by the OAuth `state`. A
// server restart mid-flow invalidates pending logins — acceptable.
const pending = new Map<string, PendingFlow>();

function prune(): void {
  const now = Date.now();
  for (const [state, flow] of pending) if (now > flow.expires) pending.delete(state);
}

/**
 * Begin OAuth for a connection: discover → register → build the authorization URL.
 * Returns the URL the browser must visit; stashes PKCE + client info under `state`.
 */
export async function startConnectionOAuth(conn: McpConnection, userId: string): Promise<URL> {
  prune();
  const prm = await discoverOAuthProtectedResourceMetadata(conn.endpoint);
  const authServerUrl = prm.authorization_servers?.[0];
  if (!authServerUrl) throw new Error("upstream does not advertise an authorization server");
  const asMetadata = await discoverAuthorizationServerMetadata(authServerUrl);
  if (!asMetadata) throw new Error("could not load authorization server metadata");

  const redirectUrl = callbackUrl();
  const clientInfo = await registerClient(authServerUrl, {
    metadata: asMetadata,
    clientMetadata: {
      client_name: "Ikarus",
      redirect_uris: [redirectUrl],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  });

  const state = randomBytes(24).toString("base64url");
  const scope = prm.scopes_supported?.join(" ") ?? asMetadata.scopes_supported?.join(" ");
  const resource = prm.resource ? new URL(prm.resource) : undefined;
  const { authorizationUrl, codeVerifier } = await startAuthorization(authServerUrl, {
    metadata: asMetadata,
    clientInformation: clientInfo,
    redirectUrl,
    state,
    ...(scope ? { scope } : {}),
    ...(resource ? { resource } : {}),
  });

  pending.set(state, {
    userId,
    connectionId: conn.id,
    authServerUrl: String(authServerUrl),
    asMetadata,
    clientInfo,
    codeVerifier,
    redirectUrl,
    ...(prm.resource ? { resource: prm.resource } : {}),
    expires: Date.now() + FLOW_TTL_MS,
  });
  return authorizationUrl;
}

/**
 * Handle the upstream's redirect back: exchange the code for a token, store it
 * encrypted on the connection, and bounce the browser to the SPA with a result.
 * Owns the response. Auth is the unguessable `state` (the browser has no JWT here).
 */
export async function handleOAuthCallback(_req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const back = (params: string, connId?: string): void => {
    const path = connId ? `/connections/${encodeURIComponent(connId)}` : "/connections";
    res.writeHead(302, { location: `${webOrigin()}${path}?${params}` }).end();
  };

  const error = url.searchParams.get("error");
  if (error) return back(`oauth=error&msg=${encodeURIComponent(error)}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("oauth=error&msg=missing+code+or+state");

  const flow = pending.get(state);
  pending.delete(state);
  if (!flow || Date.now() > flow.expires) return back("oauth=error&msg=expired+or+unknown+state");

  try {
    const tokens = await exchangeAuthorization(flow.authServerUrl, {
      metadata: flow.asMetadata,
      clientInformation: flow.clientInfo,
      authorizationCode: code,
      codeVerifier: flow.codeVerifier,
      redirectUri: flow.redirectUrl,
      ...(flow.resource ? { resource: new URL(flow.resource) } : {}),
    });
    await db().mcpConnection.updateMany({
      where: { id: flow.connectionId, userId: flow.userId },
      data: {
        encryptedCreds: encryptSecret(tokens.access_token),
        credLast4: last4(tokens.access_token),
        status: "unverified",
      },
    });
    back("oauth=connected", flow.connectionId);
  } catch (err) {
    back(`oauth=error&msg=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`, flow.connectionId);
  }
}

export function isOAuthCallback(pathname: string): boolean {
  return pathname === CALLBACK_PATH;
}

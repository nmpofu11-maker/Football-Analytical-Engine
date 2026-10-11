import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const IDENTITY_ROOT = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const DRIVE_FOLDER = "FootballAnalyticalEngine";
const SCOPES = ["offline_access", "User.Read", "Files.ReadWrite"];
const STATE_TTL_MS = 10 * 60 * 1000;

type OAuthState = { value: string; expiresAt: number };
type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; token_type?: string };
type DriveItem = { id: string; name: string; eTag?: string; size?: number; lastModifiedDateTime?: string };

const pendingStates = new Map<string, OAuthState>();
let accessToken = "";
let accessTokenExpiresAt = 0;
let latestRefreshToken = "";
let lastSuccessAt: string | null = null;
let lastErrorCode: string | null = null;
let requestCount = 0;

function config() {
  return {
    clientId: process.env.ONEDRIVE_CLIENT_ID || "",
    clientSecret: process.env.ONEDRIVE_CLIENT_SECRET || "",
    redirectUri: process.env.ONEDRIVE_REDIRECT_URI || "",
    refreshToken: process.env.ONEDRIVE_REFRESH_TOKEN || "",
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.clientId && c.clientSecret && c.redirectUri && c.refreshToken);
}

function safeErrorCode(status: number, body: string) {
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409 || status === 412) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "UPSTREAM_UNAVAILABLE";
  const match = body.match(/"code"\s*:\s*"([A-Za-z0-9_.-]+)"/);
  return match?.[1]?.slice(0, 80) || "GRAPH_REQUEST_FAILED";
}

async function parseError(response: Response): Promise<Error> {
  const body = (await response.text()).slice(0, 1200);
  const error = new Error(`Microsoft Graph request failed (${response.status}): ${safeErrorCode(response.status, body)}`);
  (error as any).status = response.status;
  (error as any).code = safeErrorCode(response.status, body);
  return error;
}

async function tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
  const c = config();
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: c.redirectUri,
    ...fields,
  });
  const response = await fetch(`${IDENTITY_ROOT}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw await parseError(response);
  return await response.json() as TokenResponse;
}

async function getAccessToken(): Promise<string> {
  if (!isConfigured()) throw Object.assign(new Error("Personal OneDrive is not configured."), { code: "ONEDRIVE_NOT_CONFIGURED" });
  if (accessToken && Date.now() < accessTokenExpiresAt - 60_000) return accessToken;

  const refreshToken = latestRefreshToken || config().refreshToken;
  if (!refreshToken) throw Object.assign(new Error("OneDrive refresh token is missing."), { code: "ONEDRIVE_AUTH_REQUIRED" });
  const result = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "offline_access User.Read Files.ReadWrite",
  });
  accessToken = result.access_token;
  accessTokenExpiresAt = Date.now() + Math.max(60, result.expires_in || 3600) * 1000;
  // Keep a rotated token in memory for this process. The configured bootstrap
  // refresh token remains in Secret Manager and can be replaced during rotation.
  if (result.refresh_token) latestRefreshToken = result.refresh_token;
  return accessToken;
}

async function graph(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  requestCount++;
  const response = await fetch(`${GRAPH_ROOT}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      ...(init.headers || {}),
    },
    signal: init.signal || AbortSignal.timeout(20000),
  });
  if (response.status === 401) {
    accessToken = "";
    accessTokenExpiresAt = 0;
  }
  if (!response.ok) {
    const error = await parseError(response);
    lastErrorCode = (error as any).code || "GRAPH_REQUEST_FAILED";
    throw error;
  }
  lastSuccessAt = new Date().toISOString();
  lastErrorCode = null;
  return response;
}

function safeFileName(name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.json$/.test(name) || name.includes("..")) {
    throw new Error("OneDrive storage only accepts simple JSON filenames.");
  }
  return name;
}

async function ensureFolder(): Promise<DriveItem> {
  const folderPath = `/me/drive/root:/${DRIVE_FOLDER.replace(/\//g, "%2F")}`;
  const existing = await fetch(`${GRAPH_ROOT}${folderPath}`, {
    headers: { Authorization: `Bearer ${await getAccessToken()}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  requestCount++;
  if (existing.ok) {
    lastSuccessAt = new Date().toISOString();
    return await existing.json() as DriveItem;
  }
  if (existing.status !== 404) {
    const error = await parseError(existing);
    lastErrorCode = (error as any).code || "GRAPH_REQUEST_FAILED";
    throw error;
  }
  const created = await graph("/me/drive/root/children", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: DRIVE_FOLDER,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  });
  return await created.json() as DriveItem;
}

async function getFileMetadata(name: string): Promise<DriveItem | null> {
  const encoded = encodeURIComponent(safeFileName(name));
  const response = await fetch(`${GRAPH_ROOT}/me/drive/root:/${DRIVE_FOLDER}/${encoded}`, {
    headers: { Authorization: `Bearer ${await getAccessToken()}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  requestCount++;
  if (response.status === 404) return null;
  if (!response.ok) throw await parseError(response);
  return await response.json() as DriveItem;
}

export function createOneDriveAuthorization() {
  const c = config();
  if (!c.clientId || !c.clientSecret || !c.redirectUri) {
    throw Object.assign(new Error("Set ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET and ONEDRIVE_REDIRECT_URI before starting consent."), { code: "ONEDRIVE_APP_NOT_CONFIGURED" });
  }
  const state = randomBytes(32).toString("base64url");
  pendingStates.set(createHash("sha256").update(state).digest("hex"), { value: state, expiresAt: Date.now() + STATE_TTL_MS });
  for (const [key, item] of pendingStates) if (item.expiresAt < Date.now()) pendingStates.delete(key);
  const url = new URL(`${IDENTITY_ROOT}/authorize`);
  url.searchParams.set("client_id", c.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", c.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return { authorizationUrl: url.toString(), expiresInSeconds: STATE_TTL_MS / 1000 };
}

export function consumeOneDriveOAuthState(state: string): boolean {
  if (!state || state.length > 256) return false;
  const key = createHash("sha256").update(state).digest("hex");
  const item = pendingStates.get(key);
  pendingStates.delete(key);
  if (!item || item.expiresAt < Date.now()) return false;
  const a = Buffer.from(item.value);
  const b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function exchangeOneDriveAuthorizationCode(code: string) {
  if (!code || code.length > 8192) throw new Error("Missing or invalid Microsoft authorization code.");
  const result = await tokenRequest({
    grant_type: "authorization_code",
    code,
    scope: SCOPES.join(" "),
  });
  if (!result.refresh_token) throw new Error("Microsoft did not return a refresh token. Ensure offline_access was consented to.");
  latestRefreshToken = result.refresh_token;
  accessToken = result.access_token;
  accessTokenExpiresAt = Date.now() + Math.max(60, result.expires_in || 3600) * 1000;
  return { refreshToken: result.refresh_token, expiresIn: result.expires_in };
}

export function getOneDriveStorageDiagnostics() {
  return {
    provider: "onedrive-graph",
    configured: isConfigured(),
    appRegistrationConfigured: Boolean(config().clientId && config().clientSecret && config().redirectUri),
    refreshTokenConfigured: Boolean(config().refreshToken),
    authenticatedInProcess: Boolean(accessToken && Date.now() < accessTokenExpiresAt),
    folderName: DRIVE_FOLDER,
    requestCount,
    lastSuccessAt,
    lastErrorCode,
    durableStorageVerified: false,
    note: "Configuration alone is not proof of durable storage. Run a read/write/read-back probe and then migrate app data paths before enabling writes.",
  };
}

export async function probeOneDriveStorage() {
  const driveResponse = await graph("/me/drive");
  const drive = await driveResponse.json() as { id?: string; driveType?: string; quota?: { total?: number; used?: number } };
  const folder = await ensureFolder();
  return {
    connected: true,
    driveType: drive.driveType || "personal",
    driveId: drive.id || null,
    folderId: folder.id || null,
    folderName: DRIVE_FOLDER,
    lastSuccessAt,
  };
}

export async function readOneDriveJson<T = unknown>(name: string): Promise<{ value: T; eTag: string | null } | null> {
  const safeName = safeFileName(name);
  const metadata = await getFileMetadata(safeName);
  if (!metadata) return null;
  const response = await graph(`/me/drive/items/${encodeURIComponent(metadata.id)}/content`, { headers: { "Accept": "*/*" } });
  const value = await response.json() as T;
  return { value, eTag: metadata.eTag || null };
}

export async function writeOneDriveJson(name: string, value: unknown, expectedETag?: string | null) {
  const safeName = safeFileName(name);
  await ensureFolder();
  const metadata = await getFileMetadata(safeName);
  if (expectedETag !== undefined && (metadata?.eTag || null) !== expectedETag) {
    throw Object.assign(new Error("OneDrive file changed since it was read; refusing to overwrite newer data."), { code: "ONEDRIVE_ETAG_CONFLICT", status: 412 });
  }
  const body = JSON.stringify(value, null, 2);
  const url = metadata
    ? `/me/drive/items/${encodeURIComponent(metadata.id)}/content`
    : `/me/drive/root:/${DRIVE_FOLDER}/${encodeURIComponent(safeName)}:/content`;
  const response = await graph(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(metadata?.eTag ? { "If-Match": metadata.eTag } : {}),
    },
    body,
  });
  const item = await response.json() as DriveItem;
  // Read-back verification prevents treating an accepted upload as durable evidence.
  const verify = await readOneDriveJson(safeName);
  if (!verify || JSON.stringify(verify.value) !== JSON.stringify(JSON.parse(body))) {
    throw Object.assign(new Error("OneDrive write completed but read-back verification failed."), { code: "ONEDRIVE_READBACK_FAILED" });
  }
  return { name: safeName, id: item.id, eTag: item.eTag || null, verified: true, size: Buffer.byteLength(body, "utf8") };
}

import { invoke } from "@tauri-apps/api/core";

// ── OAuth application identifiers ─────────────────────────────────────────────
// These are the client IDs for the respective CLIs / first-party desktop apps.
// Anthropic: same client ID used by the Claude Code CLI (open-source, public).
// OpenAI: standard platform OAuth client for desktop apps.

const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OPENAI_CLIENT_ID    = "app_64dbe28a84fc04d8f5e0f76e2ab2358f"; // Codex CLI client ID

const ANTHROPIC_AUTH_URL  = "https://claude.ai/oauth/authorize";
const ANTHROPIC_TOKEN_URL = "https://api.anthropic.com/oauth/token";

const OPENAI_AUTH_URL     = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL    = "https://auth.openai.com/oauth/token";

const TAURI_REQUIRED_MSG =
  "OAuth login requires the Tauri desktop runtime. Launch Nova with `npm run tauri:dev`, or use CLI login instead.";

// ── PKCE helpers (Web Crypto API) ─────────────────────────────────────────────

function base64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateVerifier(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return base64url(arr);
}

async function deriveChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(digest);
}

// ── Core OAuth PKCE flow ──────────────────────────────────────────────────────

export interface OAuthToken {
  accessToken: string;
  tokenType: string;
  expiresAt?: number; // unix ms
  refreshToken?: string;
  scope?: string;
}

function assertTauriRuntime(): void {
  if (typeof window === "undefined") {
    throw new Error(TAURI_REQUIRED_MSG);
  }

  const internalInvoke = (window as Window & {
    __TAURI_INTERNALS__?: { invoke?: unknown };
  }).__TAURI_INTERNALS__?.invoke;

  if (typeof internalInvoke !== "function") {
    throw new Error(TAURI_REQUIRED_MSG);
  }
}

export function canUseOAuthLogin(): boolean {
  if (typeof window === "undefined") return false;
  const internalInvoke = (window as Window & {
    __TAURI_INTERNALS__?: { invoke?: unknown };
  }).__TAURI_INTERNALS__?.invoke;
  return typeof internalInvoke === "function";
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("invoke")) {
      throw new Error(TAURI_REQUIRED_MSG);
    }
    throw error;
  }
}

async function runOAuthFlow(
  authUrl: string,
  tokenUrl: string,
  clientId: string,
  scope: string,
): Promise<OAuthToken> {
  assertTauriRuntime();

  const verifier  = generateVerifier();
  const challenge = await deriveChallenge(verifier);
  const state     = crypto.randomUUID();

  // 1. Start the local redirect server — Rust picks a free port
  const port: number = await tauriInvoke("start_oauth_server");
  const redirectUri = `http://localhost:${port}/callback`;

  // 2. Build the authorization URL
  const params = new URLSearchParams({
    response_type:         "code",
    client_id:             clientId,
    redirect_uri:          redirectUri,
    scope,
    code_challenge:        challenge,
    code_challenge_method: "S256",
    state,
  });

  // 3. Open the browser — Rust local server is already listening
  await tauriInvoke("open_url", { url: `${authUrl}?${params}` });

  // 4. Block until Rust captures the redirect (browser hits localhost:PORT/callback)
  const raw: string = await tauriInvoke("collect_oauth_callback");
  const cb = JSON.parse(raw) as Record<string, string>;

  if (cb.error) {
    throw new Error(cb.error_description ?? cb.error);
  }
  if (cb.state !== state) {
    throw new Error("OAuth state mismatch — possible CSRF. Please try again.");
  }
  if (!cb.code) {
    throw new Error("No authorization code received from provider.");
  }

  // 5. Exchange code → token
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type:    "authorization_code",
      code:          cb.code,
      redirect_uri:  redirectUri,
      client_id:     clientId,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Token exchange failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as {
    access_token:  string;
    token_type?:   string;
    expires_in?:   number;
    refresh_token?: string;
    scope?:        string;
  };

  if (!data.access_token) {
    throw new Error("Provider returned no access token.");
  }

  return {
    accessToken:  data.access_token,
    tokenType:    data.token_type ?? "Bearer",
    expiresAt:    data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    refreshToken: data.refresh_token,
    scope:        data.scope,
  };
}

// ── Provider-specific entry points ────────────────────────────────────────────

export async function loginWithAnthropic(): Promise<OAuthToken> {
  return runOAuthFlow(
    ANTHROPIC_AUTH_URL,
    ANTHROPIC_TOKEN_URL,
    ANTHROPIC_CLIENT_ID,
    "openid profile email",
  );
}

export async function loginWithOpenAI(): Promise<OAuthToken> {
  return runOAuthFlow(
    OPENAI_AUTH_URL,
    OPENAI_TOKEN_URL,
    OPENAI_CLIENT_ID,
    "openid model.request",
  );
}

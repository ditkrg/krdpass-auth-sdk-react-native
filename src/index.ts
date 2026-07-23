import { Linking, Platform } from "react-native";

import "react-native-get-random-values";
import type {
  AuthResult,
  AuthResultError,
  AuthenticateConfig,
  GetUserInfoConfig,
  InitializeConfig,
  KrdpassEnvironment,
  KrdpassTokenResult,
  KrdpassUserInfo,
  PkcePair,
  RefreshTokensConfig,
  RevokeTokenConfig,
  SignInConfig,
  TokenClaims,
  VerifyTokenConfig,
} from "./KrdpassAuthReactNative.types";
import {
  KrdpassAuthError,
  isAuthResultError,
  installUrlFor,
  makeTokenResult,
  messageForErrorCode,
} from "./KrdpassAuthReactNative.types";
import KrdpassAuthReactNativeModule from "./KrdpassAuthReactNativeModule";

export type {
  AuthErrorCode,
  AuthResult,
  AuthResultBusy,
  AuthResultCancelled,
  AuthResultError,
  AuthResultErrorBase,
  AuthResultErrorGeneric,
  AuthResultInvalidRedirect,
  AuthResultLaunchFailed,
  AuthResultPlatformError,
  AuthResultProviderNotInstalled,
  AuthResultStateMismatch,
  AuthResultSuccess,
  AuthResultTimeout,
  AuthenticateConfig,
  GetUserInfoConfig,
  InitializeConfig,
  KrdpassEnvironment,
  KrdpassTokenResult,
  KrdpassUserInfo,
  PkcePair,
  RefreshTokensConfig,
  RevokeTokenConfig,
  SignInConfig,
  TokenClaims,
  VerifyTokenConfig,
} from "./KrdpassAuthReactNative.types";

export {
  KrdpassAuthError,
  KrdpassScopes,
  KrdpassMessages,
  isAuthResultBusy,
  isAuthResultCancelled,
  isAuthResultError,
  isAuthResultSuccess,
  isAuthResultTimeout,
  isAuthResultProviderNotInstalled,
} from "./KrdpassAuthReactNative.types";

// ---------------------------------------------------------------------------
// Stored configuration (set via initialize())
// ---------------------------------------------------------------------------
let _storedConfig: InitializeConfig | null = null;

/**
 * Initialize the SDK with global configuration.
 *
 * Call this once at app startup. After initialization, clientId, redirectUri,
 * and environment are stored and used for all subsequent calls (authenticate,
 * signIn, getUserInfo, etc.); they cannot be overridden per call. Per-call
 * options are limited to scopes and timeout.
 *
 * @param config - clientId, redirectUri, and optional environment
 */
export function initialize(config: InitializeConfig): void {
  _storedConfig = {
    clientId: assertNonEmpty(config.clientId, "clientId"),
    redirectUri: assertHttpsRedirectUri(config.redirectUri),
    environment: config.environment,
  };
}

/**
 * Resolve clientId/redirectUri/environment from the config stored by
 * {@link initialize}. Throws if {@link initialize} has not been called, matching
 * the Android/Flutter SDKs, which are also configured once via initialize().
 */
function resolveConfig(): {
  clientId: string;
  redirectUri: string;
  environment: KrdpassEnvironment;
} {
  return {
    clientId: assertNonEmpty(
      _storedConfig?.clientId,
      "clientId (call initialize() first)",
    ),
    redirectUri: assertHttpsRedirectUri(
      assertNonEmpty(
        _storedConfig?.redirectUri,
        "redirectUri (call initialize() first)",
      ),
    ),
    environment: _storedConfig?.environment ?? "production",
  };
}

// Host class excludes '@' so a userinfo authority (https://evil.com@good.com)
// cannot masquerade as an allowed host in this convenience guard.
const HTTPS_REDIRECT_URI_REGEX =
  /^https:\/\/[^/\s?#@]+(?::\d{1,5})?(?:[/?#].*)?$/i;

const assertNonEmpty = (value: string | undefined, field: string): string => {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
};

const assertHttpsRedirectUri = (redirectUri: string): string => {
  const normalized = assertNonEmpty(redirectUri, "redirectUri");
  if (!HTTPS_REDIRECT_URI_REGEX.test(normalized)) {
    throw new Error("redirectUri must be a valid HTTPS URL");
  }
  return normalized;
};

/**
 * On iOS, forward the `url` Linking event to the native module for the duration of `fn`.
 * Android handles the redirect via onActivityResult and needs no listener. Shared by
 * signIn and authenticate so they use identical setup/teardown.
 */
async function withIosUrlForwarding<T>(fn: () => Promise<T>): Promise<T> {
  let sub: ReturnType<typeof Linking.addEventListener> | undefined;
  if (Platform.OS === "ios") {
    sub = Linking.addEventListener("url", ({ url }) => {
      KrdpassAuthReactNativeModule.handleURL?.(url);
    });
  }
  try {
    return await fn();
  } finally {
    sub?.remove();
  }
}

/**
 * Sign in with KRDPASS using client-only (direct) mode.
 *
 * This method handles the complete OAuth flow directly with CAS,
 * without requiring a backend server. It generates PKCE internally,
 * pushes the authorization request, launches KRDPASS, and exchanges
 * the code for tokens.
 *
 * @param config - Configuration including clientId, redirectUri, and optional scopes
 * @returns Promise resolving to tokens (accessToken, idToken, refreshToken, etc.)
 * @throws Error if authentication fails or is cancelled
 */
export async function signIn(
  config: SignInConfig = {},
): Promise<KrdpassTokenResult> {
  return withIosUrlForwarding(async () => {
    const resolved = resolveConfig();
    if (
      config.timeout !== undefined &&
      (!Number.isFinite(config.timeout) || config.timeout <= 0)
    ) {
      throw new Error("timeout must be a positive number of seconds");
    }
    const scopes = Array.isArray(config.scopes)
      ? config.scopes.join(" ")
      : config.scopes;
    let native: KrdpassTokenResult;
    try {
      native = (await KrdpassAuthReactNativeModule.signIn({
        clientId: resolved.clientId,
        redirectUri: resolved.redirectUri,
        environment: resolved.environment,
        ...(scopes !== undefined ? { scopes } : {}),
        ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
      })) as KrdpassTokenResult;
    } catch (e) {
      // Both native modules REJECT the promise on every signIn failure
      // (cancel/state_mismatch/timeout/no_code/invalid_redirect/...), carrying the
      // structured code on the rejection. Normalize into the documented
      // KrdpassAuthError so signIn behaves identically on every platform.
      // (The trust path always fails closed: no tokens are emitted on these paths.)
      if (e instanceof KrdpassAuthError) throw e;
      const code =
        (e as { code?: string } | null)?.code ?? "authentication_failed";
      const { errorDescription, installUrl } = errorParts(
        code,
        e instanceof Error ? e.message : undefined,
        resolved.environment,
      );
      throw new KrdpassAuthError(code, errorDescription, installUrl);
    }
    return makeTokenResult(native);
  });
}

/**
 * Get user information from CAS using an access token.
 *
 * @param config - Configuration including accessToken
 * @returns Promise resolving to the typed user info (raw claims on `.raw`)
 */
export async function getUserInfo(
  config: GetUserInfoConfig,
): Promise<KrdpassUserInfo> {
  const resolved = resolveConfig();
  const accessToken = assertNonEmpty(config.accessToken, "accessToken");
  const raw = (await KrdpassAuthReactNativeModule.getUserInfo({
    ...config,
    clientId: resolved.clientId,
    accessToken,
    environment: resolved.environment,
  })) as Record<string, any>;
  return mapUserInfo(raw);
}

/**
 * Map the raw UserInfo claims (snake_case) into the typed {@link KrdpassUserInfo}
 * shape used by the Android/Flutter SDKs, preserving the full claim set on `raw`.
 */
function mapUserInfo(raw: Record<string, any>): KrdpassUserInfo {
  const sub = raw.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("Invalid user info response: missing or empty sub field");
  }
  const nameParts = [
    raw.citizen_first,
    raw.citizen_second,
    raw.citizen_third,
    raw.citizen_surname,
  ].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return {
    sub,
    name: raw.name,
    givenName: raw.given_name,
    familyName: raw.family_name,
    picture: raw.picture ?? raw.citizen_profile_picture,
    email: raw.email,
    citizenFirst: raw.citizen_first,
    citizenSecond: raw.citizen_second,
    citizenThird: raw.citizen_third,
    citizenSurname: raw.citizen_surname,
    citizenProfilePicture: raw.citizen_profile_picture,
    birthdate: raw.birthdate,
    sexAtBirth: raw.sex_at_birth,
    upn: raw.upn,
    did: raw.did,
    citizenFullName: nameParts.length ? nameParts.join(" ") : undefined,
    raw,
  };
}

/**
 * Refresh tokens using a refresh token.
 *
 * @param config - Configuration including refreshToken
 * @returns Promise resolving to new tokens
 */
export async function refreshTokens(
  config: RefreshTokensConfig,
): Promise<KrdpassTokenResult> {
  const resolved = resolveConfig();
  const refreshToken = assertNonEmpty(config.refreshToken, "refreshToken");
  const native = (await KrdpassAuthReactNativeModule.refreshTokens({
    ...config,
    clientId: resolved.clientId,
    refreshToken,
    environment: resolved.environment,
  })) as KrdpassTokenResult;
  return makeTokenResult(native);
}

/**
 * Revoke an access or refresh token.
 *
 * @param config - Configuration including token to revoke
 */
export async function revokeToken(config: RevokeTokenConfig): Promise<void> {
  const resolved = resolveConfig();
  const token = assertNonEmpty(config.token, "token");
  await KrdpassAuthReactNativeModule.revokeToken({
    ...config,
    clientId: resolved.clientId,
    token,
    environment: resolved.environment,
  });
}

/**
 * Verify an ID token's signature using JWKS.
 *
 * Fetches the public keys from the JWKS endpoint and validates:
 * - RS256 signature
 * - Audience (`aud` must equal your clientId)
 * - Token expiration (exp claim)
 * - Token not-before (nbf claim)
 * - Token issued-at (iat claim)
 *
 * Note: this convenience verifier does not pin the issuer. The client-only
 * {@link signIn} flow performs the full issuer + nonce-bound validation.
 *
 * @param config - Configuration including idToken to verify and optional
 *   clockSkew (allowed skew in seconds for exp/nbf/iat; defaults to 60)
 * @returns Promise resolving to verified token claims
 * @throws Error if token signature is invalid or claims fail validation
 */
export async function verifyToken(
  config: VerifyTokenConfig,
): Promise<TokenClaims> {
  const resolved = resolveConfig();
  const idToken = assertNonEmpty(config.idToken, "idToken");
  const clockSkew = config.clockSkew ?? 60;
  if (!Number.isFinite(clockSkew) || clockSkew < 0) {
    throw new Error("clockSkew must be a non-negative number of seconds");
  }
  return (await KrdpassAuthReactNativeModule.verifyToken({
    ...config,
    clientId: resolved.clientId,
    idToken,
    clockSkew,
    environment: resolved.environment,
  })) as TokenClaims;
}

/**
 * Generate a PKCE code verifier and challenge pair.
 * Use this for server-mediated authentication flows.
 */
export async function generatePkcePair(): Promise<PkcePair> {
  const { codeVerifier, codeChallenge } =
    (await KrdpassAuthReactNativeModule.generatePkcePair()) as {
      codeVerifier: string;
      codeChallenge: string;
    };
  // KRDPASS always uses S256; surface it so callers don't hardcode the method.
  return { codeVerifier, codeChallenge, method: "S256" };
}

/**
 * The one home of the error-resolution policy shared by signIn's rejection handler and
 * authenticate's result normalization: canonical message first (native/server text as the
 * fallback), and `installUrl` derived locally from the environment (it never crosses the
 * native bridge) for `provider_not_installed`.
 */
function errorParts(
  code: string,
  fallbackDescription: string | undefined,
  environment: KrdpassEnvironment,
): { errorDescription?: string; installUrl?: string } {
  return {
    errorDescription: messageForErrorCode(code) ?? fallbackDescription,
    installUrl:
      code === "provider_not_installed"
        ? installUrlFor(environment)
        : undefined,
  };
}

/**
 * Normalize a native error payload into a typed {@link AuthResultError}.
 *
 * Reconciles the snake_case keys the native modules emit (`error_description`) with the
 * camelCase contract, in one place instead of a cast at every call site.
 */
function normalizeNativeError(
  raw: AuthResultError & { error_description?: string },
  environment: KrdpassEnvironment,
): AuthResultError {
  const { errorDescription, installUrl } = errorParts(
    raw.error,
    raw.errorDescription ?? raw.error_description,
    environment,
  );
  if (raw.error === "provider_not_installed") {
    return { error: "provider_not_installed", errorDescription, installUrl };
  }
  return { error: raw.error, errorDescription };
}

/**
 * Launch KRDPASS authentication with a pre-obtained requestUri.
 * Use this for server-mediated authentication flows where your backend
 * handles PAR and token exchange.
 *
 * @param config - Authentication configuration including requestUri from backend
 * @returns AuthResult with code and state for backend token exchange
 */
export async function authenticate(
  config: AuthenticateConfig,
): Promise<AuthResult> {
  return withIosUrlForwarding(async () => {
    const resolved = resolveConfig();
    const requestUri = assertNonEmpty(config.requestUri, "requestUri");
    const timeout =
      config.timeout === undefined ? undefined : Number(config.timeout);
    if (timeout !== undefined) {
      if (!Number.isFinite(timeout) || timeout <= 0) {
        // platform_error, not invalid_request: same wire code as the Android/iOS/Flutter SDKs
        // (and RN's own natives) for a bad local timeout argument.
        return {
          error: "platform_error",
          errorDescription: "timeout must be a positive number of seconds",
        };
      }
    }
    const result = (await KrdpassAuthReactNativeModule.authenticate({
      ...config,
      clientId: resolved.clientId,
      requestUri,
      redirectUri: resolved.redirectUri,
      ...(timeout !== undefined ? { timeout } : {}),
      environment: resolved.environment,
    })) as AuthResult | (AuthResultError & { error_description?: string });
    if (isAuthResultError(result)) {
      return normalizeNativeError(result, resolved.environment);
    }
    return result;
  });
}

/**
 * Cancel an in-flight authentication attempt.
 *
 * This is useful when the app returns to foreground without receiving a callback.
 */
export async function cancelPendingAuthentication(options?: {
  timeout?: boolean;
}): Promise<void> {
  await KrdpassAuthReactNativeModule.cancelAuthentication?.({
    timeout: options?.timeout ?? false,
  });
}

/**
 * Generate a cryptographically secure state parameter.
 * Use this for OAuth state validation in server-mediated flows.
 *
 * Note: This is a convenience method. You can also use any secure
 * random string generator for OAuth state.
 *
 * @returns A base64url-encoded random string suitable for OAuth state
 */
export function generateState(): string {
  // Generate 32 random bytes as base64url (similar to other SDKs)
  const randomBytes = new Uint8Array(32);
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error(
      "Secure random generator unavailable. Install and initialize react-native-get-random-values.",
    );
  }
  cryptoObj.getRandomValues(randomBytes);

  // Convert to base64 using btoa helper
  const binary = String.fromCharCode(...randomBytes);

  // Base64url encode (no padding)
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// btoa polyfill for React Native
const btoa = (input: string): string => {
  const btoaChars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i);
    const b = input.charCodeAt(i + 1);
    const c = input.charCodeAt(i + 2);
    const index1 = a >> 2;
    const index2 = ((a & 3) << 4) | (b >> 4);
    const index3 = ((b & 15) << 2) | (c >> 6);
    const index4 = c & 63;
    output +=
      btoaChars.charAt(index1) +
      btoaChars.charAt(index2) +
      (isNaN(b) ? "=" : btoaChars.charAt(index3)) +
      (isNaN(c) ? "=" : btoaChars.charAt(index4));
  }
  return output;
};

// Polyfill for atob
const chars =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
const atob = (input: string) => {
  let str = input;
  while (str.endsWith("=")) {
    str = str.slice(0, -1);
  }
  let output = "";

  if (str.length % 4 === 1) {
    throw new Error(
      "'atob' failed: The string to be decoded is not correctly encoded.",
    );
  }
  for (
    let bc = 0, bs = 0, buffer, i = 0;
    (buffer = str.charAt(i++));
    ~buffer && ((bs = bc % 4 ? bs * 64 + buffer : buffer), bc++ % 4)
      ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6))))
      : 0
  ) {
    buffer = chars.indexOf(buffer);
  }

  return output;
};

/**
 * Decode a JWT's claims WITHOUT verifying its signature.
 *
 * SECURITY: the returned claims are NOT authenticated and MUST NOT drive any
 * trust or authorization decision. Always use {@link verifyToken} first; this is
 * only for cosmetic display of an already-verified token.
 *
 * @param token - The JWT token to decode
 * @returns The decoded payload claims
 * @throws Error if the token is not a parseable JWT
 */
export function decodeTokenUnverified(token: string): TokenClaims {
  const parts = token.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || !payload) {
    throw new Error("Not a valid JWT: expected three parts");
  }
  try {
    // atob yields a binary (Latin1) string; re-decode it as UTF-8 so non-ASCII claims
    // (e.g. Kurdish/Arabic display names) are preserved instead of becoming mojibake.
    const binary = atob(base64UrlToBase64(payload));
    const json = decodeURIComponent(
      binary
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
    return JSON.parse(json) as TokenClaims;
  } catch (e) {
    throw new Error(`Not a valid JWT payload: ${String(e)}`);
  }
}

const base64UrlToBase64 = (input: string): string => {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4;
  if (padding > 0) {
    base64 = base64.padEnd(base64.length + (4 - padding), "=");
  }
  return base64;
};

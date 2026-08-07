import { Linking, Platform } from "react-native";

import "react-native-get-random-values";
import type {
  AuthErrorCode,
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
  KrdpassMessages,
  isAuthResultError,
  installUrlFor,
  makeTokenResult,
  messageForErrorCode,
} from "./KrdpassAuthReactNative.types";
import KrdpassAuthReactNativeModule from "./NativeKrdpassAuthReactNative";

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

// KrdpassMessages stays unexported: the codes are the contract, not the strings, and exporting
// them would make every canonical message a semver commitment.
export {
  KrdpassAuthError,
  KrdpassScopes,
  isAuthResultBusy,
  isAuthResultCancelled,
  isAuthResultError,
  isAuthResultSuccess,
  isAuthResultTimeout,
  isAuthResultProviderNotInstalled,
  // Exported because casting backend token JSON to the interface instead compiles but leaves
  // receivedAt undefined and isExpired missing, so isExpired() throws at runtime.
  makeTokenResult,
} from "./KrdpassAuthReactNative.types";

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
    environment: assertEnvironment(config.environment),
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

// Excludes '@' so a userinfo authority (https://evil.com@good.com) cannot masquerade as an
// allowed host, and rejects a fragment outright: RFC 6749 section 3.1.2 forbids one here.
const HTTPS_REDIRECT_URI_REGEX =
  /^https:\/\/[^/\s?#@]+(?::\d{1,5})?(?:[/?][^#]*)?$/i;

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
 * Validated at initialize(), like clientId and redirectUri: the value is forwarded to the
 * natives, and an unrecognized one fails there as a per-call wire error long after the
 * mistake was made. TypeScript alone does not cover it, since the value usually arrives
 * from an environment variable through a cast.
 */
const assertEnvironment = (
  environment: string | undefined,
): KrdpassEnvironment | undefined => {
  if (environment === undefined) return undefined;
  if (environment !== "production" && environment !== "development") {
    throw new Error(
      'environment must be "production" or "development" when provided',
    );
  }
  return environment;
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
      KrdpassAuthReactNativeModule.handleURL(url);
    });
  }
  try {
    return await fn();
  } finally {
    sub?.remove();
  }
}

/**
 * Run a native call and normalize any rejection into a {@link KrdpassAuthError} carrying a
 * lowercase cross-SDK error code. The one home of that policy for every rejecting method.
 *
 * `fallbackCode` is the per-call permanent-failure code used only when the rejection carries
 * no structured code of its own, matching the Android/iOS/Flutter bridges. The underlying
 * message is never replaced by a canonical string: it survives on `rawDescription`, and on
 * `errorDescription` too for a code with no canonical message (which is all of the per-call
 * codes). Losing a real CAS or OS reason on the token path is the expensive failure mode.
 *
 * Local argument validation stays outside this wrapper: those are the caller's own bugs and
 * keep throwing a plain Error, not a wire-coded one.
 */
async function callNative<T>(
  fallbackCode: AuthErrorCode,
  environment: KrdpassEnvironment | undefined,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (e instanceof KrdpassAuthError) throw e;
    const code = (e as { code?: string } | null)?.code ?? fallbackCode;
    const { errorDescription, rawDescription, installUrl } = errorParts(
      code,
      e instanceof Error ? e.message : undefined,
      environment,
    );
    throw new KrdpassAuthError(
      code,
      errorDescription,
      installUrl,
      rawDescription,
    );
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
 * @param config - Optional per-call scopes and timeout; everything else comes
 *   from {@link initialize}
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
    // Both natives reject on every signIn failure, carrying the structured code; callNative
    // normalizes it so signIn behaves identically everywhere. No tokens on any of those paths.
    const native = (await callNative(
      "authentication_failed",
      resolved.environment,
      () =>
        KrdpassAuthReactNativeModule.signIn({
          clientId: resolved.clientId,
          redirectUri: resolved.redirectUri,
          environment: resolved.environment,
          ...(scopes !== undefined ? { scopes } : {}),
          ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
        }),
    )) as KrdpassTokenResult;
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
  const raw = (await callNative("user_info_failed", resolved.environment, () =>
    KrdpassAuthReactNativeModule.getUserInfo({
      ...config,
      clientId: resolved.clientId,
      accessToken,
      environment: resolved.environment,
    }),
  )) as Record<string, unknown>;
  return mapUserInfo(raw);
}

/** Server-controlled claims are `unknown`: keep a claim only when it really is a string. */
const claimString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * Server-controlled claims are `unknown`: keep the claim only when it really is
 * an array of strings, otherwise fall back to empty rather than throwing.
 */
const claimStringArray = (value: unknown): string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string")
    ? value
    : [];

/**
 * Map the raw UserInfo claims (snake_case) into the typed {@link KrdpassUserInfo}
 * shape used by the Android/Flutter SDKs, preserving the full claim set on `raw`.
 */
function mapUserInfo(raw: Record<string, unknown>): KrdpassUserInfo {
  const sub = claimString(raw.sub);
  if (!sub) {
    throw new Error("Invalid user info response: missing or empty sub field");
  }
  // Each part is trimmed before joining, so " Aram " contributes "Aram" and a
  // whitespace-only claim contributes nothing rather than a stray space in the
  // joined name. Matches the Android, iOS and Flutter SDKs.
  const nameParts = [
    raw.citizen_first,
    raw.citizen_second,
    raw.citizen_third,
    raw.citizen_surname,
  ]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0);
  return {
    sub,
    name: claimString(raw.name),
    givenName: claimString(raw.given_name),
    familyName: claimString(raw.family_name),
    picture:
      claimString(raw.picture) ?? claimString(raw.citizen_profile_picture),
    email: claimString(raw.email),
    citizenFirst: claimString(raw.citizen_first),
    citizenSecond: claimString(raw.citizen_second),
    citizenThird: claimString(raw.citizen_third),
    citizenSurname: claimString(raw.citizen_surname),
    citizenProfilePicture: claimString(raw.citizen_profile_picture),
    birthdate: claimString(raw.birthdate),
    sexAtBirth: claimString(raw.sex_at_birth),
    upn: claimString(raw.upn),
    upns: claimStringArray(raw.upns),
    did: claimString(raw.did),
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
  const native = (await callNative("refresh_failed", resolved.environment, () =>
    KrdpassAuthReactNativeModule.refreshTokens({
      ...config,
      clientId: resolved.clientId,
      refreshToken,
      environment: resolved.environment,
    }),
  )) as KrdpassTokenResult;
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
  await callNative("revoke_failed", resolved.environment, () =>
    KrdpassAuthReactNativeModule.revokeToken({
      ...config,
      clientId: resolved.clientId,
      token,
      environment: resolved.environment,
    }),
  );
}

/**
 * Verify an ID token's signature using JWKS.
 *
 * Fetches the public keys from the JWKS endpoint and validates:
 * - RS256 signature
 * - Issuer (`iss` must equal the configured environment's authorization server)
 * - Audience (`aud` must equal your clientId)
 * - Token expiration (exp claim)
 * - Token not-before (nbf claim)
 * - Token issued-at (iat claim)
 *
 * The issuer and the audience are both pinned, on Android and on iOS. A token
 * signed by a different issuer whose key happens to be in the fetched JWKS is
 * rejected, and so is a token minted for a different client.
 *
 * The one check this call cannot make is nonce binding, because a nonce only
 * exists inside a flow that generated one. The client-only {@link signIn} flow
 * runs everything above plus that nonce check on the token it receives.
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
  return (await callNative(
    "verification_failed",
    resolved.environment,
    () =>
      KrdpassAuthReactNativeModule.verifyToken({
        ...config,
        clientId: resolved.clientId,
        idToken,
        clockSkew,
        environment: resolved.environment,
      }),
  )) as TokenClaims;
}

/**
 * Generate a PKCE code verifier and challenge pair.
 * Use this for server-mediated authentication flows.
 */
export async function generatePkcePair(): Promise<PkcePair> {
  // No resolveConfig(): a PKCE pair needs no client config, so this stays callable before
  // initialize(). Hence no environment, which only derives provider_not_installed's installUrl.
  const { codeVerifier, codeChallenge } = (await callNative(
    "pkce_generation_failed",
    undefined,
    () => KrdpassAuthReactNativeModule.generatePkcePair(),
  )) as {
    codeVerifier: string;
    codeChallenge: string;
  };
  // KRDPASS always uses S256; surface it so callers don't hardcode the method.
  return { codeVerifier, codeChallenge, method: "S256" };
}

/**
 * The one home of the error-resolution policy shared by callNative and authenticate.
 *
 * `rawDescription` always keeps the original native/server text, because `errorDescription` falls
 * back to the canonical message which collapses the whole cancellation set onto one string, losing
 * the server's real reason. Log rawDescription, render errorDescription. `installUrl` is derived
 * locally from the environment and never crosses the bridge.
 */
function errorParts(
  code: string,
  rawDescription: string | undefined,
  environment: KrdpassEnvironment | undefined,
): {
  errorDescription?: string;
  rawDescription?: string;
  installUrl?: string;
} {
  return {
    errorDescription: messageForErrorCode(code) ?? rawDescription,
    rawDescription,
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
  const { errorDescription, rawDescription, installUrl } = errorParts(
    raw.error,
    raw.errorDescription ?? raw.error_description,
    environment,
  );
  if (raw.error === "provider_not_installed") {
    return {
      error: "provider_not_installed",
      errorDescription,
      rawDescription,
      installUrl,
    };
  }
  return { error: raw.error, errorDescription, rawDescription };
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
    // Android rejects a blank state with isBlank(), iOS with isEmpty, so "   " failed closed on
    // only one platform; decided here for both. Never trimmed: the core must see the backend's
    // PAR state byte-identical.
    if (config.state !== undefined && config.state.trim().length === 0) {
      return {
        error: "invalid_request",
        errorDescription: KrdpassMessages.STATE_REQUIRED,
      };
    }
    const timeout =
      config.timeout === undefined ? undefined : Number(config.timeout);
    if (timeout !== undefined) {
      if (!Number.isFinite(timeout) || timeout <= 0) {
        // platform_error, not invalid_request: the cross-SDK code for a bad local timeout arg.
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
    // `?? undefined`: both bridges emit JSON null for an absent state (Android putNull, iOS
    // NSNull) but AuthResultSuccess declares `state?: string`. Rebuilt, not spread.
    return { code: result.code, state: result.state ?? undefined };
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
  await KrdpassAuthReactNativeModule.cancelAuthentication({
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
  const randomBytes = new Uint8Array(32);
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error(
      "Secure random generator unavailable. Install and initialize react-native-get-random-values.",
    );
  }
  cryptoObj.getRandomValues(randomBytes);

  const base64 = btoa(String.fromCharCode(...randomBytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// The engine's own base64 (Hermes has both), not a hand-rolled one: it rejects out-of-alphabet
// characters instead of skipping them, so a mangled token cannot decode cleanly. Declared here
// because neither react-native's typings nor TypeScript's ES2020 lib do.
declare function atob(data: string): string;
declare function btoa(data: string): string;

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
    // atob yields a Latin1 string; re-decode as UTF-8 so non-ASCII claims survive intact.
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

// Pad: the one input shape every atob accepts, so this does not rely on a forgiving engine.
const base64UrlToBase64 = (input: string): string => {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4;
  if (padding > 0) {
    base64 = base64.padEnd(base64.length + (4 - padding), "=");
  }
  return base64;
};

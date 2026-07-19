/**
 * Configuration for KrdpassAuth SDK
 */
export type KrdpassEnvironment = "production" | "development";

/**
 * The KRDPASS web URL for the given environment. Surfaced internally (e.g. on
 * `provider_not_installed`) as `installUrl` so callers can take the user to the
 * app store install page, matching how the iOS/Android/Flutter SDKs expose it
 * via the environment/AuthResult rather than a standalone helper.
 */
export function installUrlFor(
  environment: KrdpassEnvironment = "production",
): string {
  return environment === "production"
    ? "https://app.pass.krd"
    : "https://app.krdpass.dev.krd";
}

/**
 * Canonical OAuth/OIDC scopes offered by KRDPASS.
 *
 * Use these instead of hardcoded scope strings so the values stay in lockstep
 * with the iOS/Android/Flutter SDKs.
 */
export const KrdpassScopes = {
  openid: "openid",
  profile: "profile",
  citizen_identity: "citizen_identity",
  offline_access: "offline_access",
} as const;

/**
 * Canonical user-facing messages, byte-identical across all four KRDPASS SDKs.
 */
export const KrdpassMessages = {
  CANCELLED: "Authentication was cancelled",
  TIMEOUT: "Authentication timed out",
  BUSY: "Another authentication is already in progress",
  STATE_MISMATCH:
    "State parameter mismatch: possible CSRF or response injection",
  PROVIDER_NOT_INSTALLED:
    "The KRDPASS app is not installed or could not be opened. Please install or update KRDPASS.",
  NO_CODE: "No authorization code received",
  INVALID_REDIRECT: "Redirect URI does not match configured host",
  MISSING_ID_TOKEN: "Token response did not include an id_token",
  NONCE_MISMATCH: "ID token nonce mismatch (possible token replay)",
  STATE_REQUIRED:
    "state is required and cannot be blank. Pass the state returned by your backend's PAR call, or use signIn().",
} as const;

/**
 * Maps a wire error code to its canonical user-facing message. Returns
 * undefined for codes that have no canonical message (caller falls back to the
 * server-provided description).
 */
export function messageForErrorCode(code: string): string | undefined {
  // Every cancellation code maps to the one canonical "cancelled" message, matching the other
  // SDKs (which classify the whole CANCELLATION_CODES set as cancelled).
  if (CANCELLATION_CODES.has(code)) return KrdpassMessages.CANCELLED;
  switch (code) {
    case "timeout":
      return KrdpassMessages.TIMEOUT;
    case "busy":
      return KrdpassMessages.BUSY;
    case "state_mismatch":
      return KrdpassMessages.STATE_MISMATCH;
    case "provider_not_installed":
      return KrdpassMessages.PROVIDER_NOT_INSTALLED;
    case "no_code":
      return KrdpassMessages.NO_CODE;
    case "invalid_redirect":
      return KrdpassMessages.INVALID_REDIRECT;
    default:
      return undefined;
  }
}

/**
 * Configuration for the client-only {@link signIn} flow.
 *
 * `clientId` and `redirectUri` are optional: if omitted they fall back to the
 * values passed to {@link initialize}, so `signIn({ scopes })` works once the
 * SDK is initialized, matching the iOS/Android/Flutter SDKs.
 */
export interface SignInConfig {
  scopes?: string | string[];
  /** Optional authentication timeout in seconds. */
  timeout?: number;
}

/**
 * Configuration for initializing the SDK once.
 * After calling initialize(), clientId/redirectUri/environment
 * are stored and used as defaults for all subsequent calls.
 */
export interface InitializeConfig {
  clientId: string;
  redirectUri: string;
  environment?: KrdpassEnvironment;
}

/**
 * Token result from successful authentication.
 *
 * `receivedAt` is stamped locally on receipt (epoch ms). It is NOT read from the
 * server JSON, so {@link KrdpassTokenResult.isExpired} can be computed on-device,
 * matching the iOS/Android/Flutter SDKs.
 */
export interface KrdpassTokenResult {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
  /** Epoch milliseconds at which this result was received on this device. */
  receivedAt: number;
  /**
   * True when the access token is expired, allowing `skewSeconds` of clock skew
   * (default 60s). Computed from {@link receivedAt} + {@link expiresIn}.
   */
  isExpired(skewSeconds?: number): boolean;
}

/**
 * Wrap a raw token map from the native bridge into a {@link KrdpassTokenResult},
 * stamping `receivedAt` locally and attaching {@link KrdpassTokenResult.isExpired}.
 */
export function makeTokenResult(
  raw: Omit<KrdpassTokenResult, "receivedAt" | "isExpired"> & {
    receivedAt?: number;
  },
): KrdpassTokenResult {
  const receivedAt = Date.now();
  return {
    accessToken: raw.accessToken,
    idToken: raw.idToken,
    refreshToken: raw.refreshToken,
    expiresIn: raw.expiresIn,
    tokenType: raw.tokenType,
    scope: raw.scope,
    receivedAt,
    isExpired(skewSeconds = 60): boolean {
      const expiresAt = receivedAt + this.expiresIn * 1000;
      return Date.now() >= expiresAt - skewSeconds * 1000;
    },
  };
}

/**
 * Verified JWT claims returned by verifyToken.
 */
export type TokenClaims = Record<string, any>;

/**
 * User information claims returned by {@link getUserInfo}.
 *
 * Typed access to the standard OpenID Connect claims and the KRDPASS-specific
 * citizen claims, matching the Android/Flutter SDKs. Any unmapped/custom claims
 * remain available on `raw`.
 */
export interface KrdpassUserInfo {
  /** Subject: identifier for the End-User. */
  sub: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  email?: string;
  citizenFirst?: string;
  citizenSecond?: string;
  citizenThird?: string;
  citizenSurname?: string;
  citizenProfilePicture?: string;
  birthdate?: string;
  sexAtBirth?: string;
  upn?: string;
  did?: string;
  /** Full citizen name assembled from the known parts, if any. */
  citizenFullName?: string;
  /** Raw claims map from the UserInfo endpoint (for custom/non-standard fields). */
  raw: Record<string, unknown>;
}

/**
 * PKCE code verifier and challenge pair
 */
export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  /** PKCE challenge method: always "S256". */
  method: "S256";
}

/**
 * Success result from server-mediated authenticate call
 */
export interface AuthResultSuccess {
  code: string;
  state?: string;
}

/**
 * Canonical auth error codes returned by authenticate.
 *
 * This is a closed union so callers get exhaustiveness checking and autocomplete.
 * Forwarded server/native codes that are not listed here surface as
 * {@link AuthResultErrorGeneric} (whose `error` is a plain string).
 */
export type AuthErrorCode =
  | "cancelled"
  | "access_denied"
  | "timeout"
  | "busy"
  | "state_mismatch"
  | "invalid_redirect"
  | "invalid_request"
  | "request_expired"
  | "launch_failed"
  | "provider_not_installed"
  | "no_code"
  | "network_error"
  | "platform_error";

/**
 * Base error result from authenticate call.
 */
export interface AuthResultErrorBase {
  error: string;
  errorDescription?: string;
}

export type AuthResultCancelled = AuthResultErrorBase & { error: "cancelled" };

export type AuthResultTimeout = AuthResultErrorBase & { error: "timeout" };

export type AuthResultBusy = AuthResultErrorBase & { error: "busy" };

export type AuthResultStateMismatch = AuthResultErrorBase & {
  error: "state_mismatch";
};

export type AuthResultInvalidRedirect = AuthResultErrorBase & {
  error: "invalid_redirect";
};

export type AuthResultLaunchFailed = AuthResultErrorBase & {
  error: "launch_failed";
};

export interface AuthResultProviderNotInstalled extends AuthResultErrorBase {
  error: "provider_not_installed";
  /** The KRDPASS web URL. Open in a browser to take the user to the app store install page. */
  installUrl?: string;
}

export type AuthResultPlatformError = AuthResultErrorBase & {
  error: "platform_error";
};

// Escape hatch for forwarded server/native error codes not in AuthErrorCode.
export type AuthResultErrorGeneric = AuthResultErrorBase;

/**
 * Typed error result from authenticate call.
 */
export type AuthResultError =
  | AuthResultCancelled
  | AuthResultTimeout
  | AuthResultBusy
  | AuthResultStateMismatch
  | AuthResultInvalidRedirect
  | AuthResultLaunchFailed
  | AuthResultProviderNotInstalled
  | AuthResultPlatformError
  | AuthResultErrorGeneric;

/**
 * Result from server-mediated authenticate call.
 * Success: code and optional state. Failure: error and optional errorDescription.
 */
export type AuthResult = AuthResultSuccess | AuthResultError;

export function isAuthResultSuccess(r: AuthResult): r is AuthResultSuccess {
  return "code" in r && !("error" in r);
}

export function isAuthResultError(r: AuthResult): r is AuthResultError {
  return "error" in r;
}

/**
 * Wire error codes that all classify a result as a user cancellation, matching
 * the iOS/Android/Flutter SDKs. `access_denied`/`login_required`/`consent_denied`
 * are OAuth-level "user declined / re-auth required" responses surfaced as cancels.
 */
const CANCELLATION_CODES = new Set([
  "cancelled",
  "user_cancelled",
  "access_denied",
  "login_required",
  "consent_denied",
]);

export function isAuthResultCancelled(r: AuthResult): r is AuthResultCancelled {
  return isAuthResultError(r) && CANCELLATION_CODES.has(r.error);
}

export function isAuthResultTimeout(r: AuthResult): r is AuthResultTimeout {
  return isAuthResultError(r) && r.error === "timeout";
}

export function isAuthResultBusy(r: AuthResult): r is AuthResultBusy {
  return isAuthResultError(r) && r.error === "busy";
}

export function isAuthResultProviderNotInstalled(
  r: AuthResult,
): r is AuthResultProviderNotInstalled {
  return isAuthResultError(r) && r.error === "provider_not_installed";
}

/**
 * Error thrown by the client-only {@link signIn} flow when authentication
 * fails or is cancelled.
 *
 * `code` is one of {@link AuthErrorCode} (e.g. `"cancelled"`, `"state_mismatch"`,
 * `"timeout"`) or a forwarded server/native error string, so callers can branch
 * on the failure:
 *
 * ```ts
 * try {
 *   const tokens = await signIn();
 * } catch (e) {
 *   if (e instanceof KrdpassAuthError && e.code === "cancelled") { ... }
 * }
 * ```
 *
 * Mirrors the throwing contract of the iOS/Android/Flutter SDKs.
 */
export class KrdpassAuthError extends Error {
  readonly code: string;
  readonly errorDescription?: string;
  /** The KRDPASS install URL when `code` is `provider_not_installed`; undefined otherwise. */
  readonly installUrl?: string;

  constructor(code: string, errorDescription?: string, installUrl?: string) {
    super(errorDescription ?? code);
    this.name = "KrdpassAuthError";
    this.code = code;
    this.errorDescription = errorDescription;
    this.installUrl = installUrl;
    // Restore the prototype chain (transpilation to ES5 otherwise breaks instanceof).
    Object.setPrototypeOf(this, KrdpassAuthError.prototype);
  }
}

/**
 * Configuration for server-mediated authenticate call
 */
export interface AuthenticateConfig {
  requestUri: string;
  state?: string;
  /**
   * Optional authentication timeout in seconds.
   * If omitted, native SDK defaults are used.
   */
  timeout?: number;
}

/**
 * Configuration for verifyToken call.
 * Validates ID token signature using JWKS endpoint.
 */
export interface VerifyTokenConfig {
  idToken: string;
  /** Allowed clock skew in seconds for exp/nbf/iat checks. Defaults to 60. */
  clockSkew?: number;
}

/**
 * Configuration for getUserInfo call.
 * Fetches user claims from the userinfo endpoint.
 */
export interface GetUserInfoConfig {
  accessToken: string;
}

/**
 * Configuration for refreshTokens call.
 * Exchanges a refresh token for new access and ID tokens.
 */
export interface RefreshTokensConfig {
  refreshToken: string;
  scope?: string;
}

/**
 * Configuration for revokeToken call.
 * Invalidates an access or refresh token at the authorization server.
 */
export interface RevokeTokenConfig {
  token: string;
  tokenTypeHint?: "access_token" | "refresh_token";
}

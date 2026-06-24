/**
 * Configuration for KrdpassAuth SDK
 */
export type KrdpassEnvironment = "production" | "development";

/**
 * Configuration for the client-only {@link signIn} flow.
 *
 * `clientId` and `redirectUri` are optional: if omitted they fall back to the
 * values passed to {@link initialize}, so `signIn({ scopes })` works once the
 * SDK is initialized — matching the iOS/Android/Flutter SDKs.
 */
export interface SignInConfig {
  clientId?: string;
  redirectUri?: string;
  scopes?: string | string[];
  environment?: KrdpassEnvironment;
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
 * Token result from successful authentication
 */
export interface KrdpassTokenResult {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
}

/**
 * Verified JWT claims returned by verifyToken.
 */
export type TokenClaims = Record<string, any>;

/**
 * User information claims returned by {@link getUserInfo}.
 *
 * Typed access to the standard OpenID Connect claims and the KRDPass-specific
 * citizen claims, matching the Android/Flutter SDKs. Any unmapped/custom claims
 * remain available on `raw`.
 */
export interface KrdpassUserInfo {
  /** Subject — identifier for the End-User. */
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

export interface AuthResultCancelled extends AuthResultErrorBase {
  error: "cancelled";
}

export interface AuthResultTimeout extends AuthResultErrorBase {
  error: "timeout";
}

export interface AuthResultBusy extends AuthResultErrorBase {
  error: "busy";
}

export interface AuthResultStateMismatch extends AuthResultErrorBase {
  error: "state_mismatch";
}

export interface AuthResultInvalidRedirect extends AuthResultErrorBase {
  error: "invalid_redirect";
}

export interface AuthResultLaunchFailed extends AuthResultErrorBase {
  error: "launch_failed";
}

export interface AuthResultPlatformError extends AuthResultErrorBase {
  error: "platform_error";
}

export interface AuthResultErrorGeneric extends AuthResultErrorBase {
  // Escape hatch for forwarded server/native error codes not in AuthErrorCode.
  error: string;
}

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

export function isAuthResultCancelled(r: AuthResult): r is AuthResultCancelled {
  // access_denied (user declined consent) is treated as a cancellation,
  // matching the Android/Flutter SDKs.
  return (
    isAuthResultError(r) &&
    (r.error === "cancelled" || r.error === "access_denied")
  );
}

export function isAuthResultTimeout(r: AuthResult): r is AuthResultTimeout {
  return isAuthResultError(r) && r.error === "timeout";
}

export function isAuthResultBusy(r: AuthResult): r is AuthResultBusy {
  return isAuthResultError(r) && r.error === "busy";
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

  constructor(code: string, errorDescription?: string) {
    super(errorDescription ?? code);
    this.name = "KrdpassAuthError";
    this.code = code;
    this.errorDescription = errorDescription;
    // Restore the prototype chain (transpilation to ES5 otherwise breaks instanceof).
    Object.setPrototypeOf(this, KrdpassAuthError.prototype);
  }
}

/**
 * Configuration for server-mediated authenticate call
 */
export interface AuthenticateConfig {
  clientId?: string;
  redirectUri?: string;
  requestUri: string;
  state?: string;
  /**
   * Optional authentication timeout in seconds.
   * If omitted, native SDK defaults are used.
   */
  timeout?: number;
  environment?: KrdpassEnvironment;
}

/**
 * Configuration for verifyToken call.
 * Validates ID token signature using JWKS endpoint.
 */
export interface VerifyTokenConfig {
  clientId?: string;
  environment?: KrdpassEnvironment;
  idToken: string;
}

/**
 * Configuration for getUserInfo call.
 * Fetches user claims from the userinfo endpoint.
 */
export interface GetUserInfoConfig {
  clientId?: string;
  environment?: KrdpassEnvironment;
  accessToken: string;
}

/**
 * Configuration for refreshTokens call.
 * Exchanges a refresh token for new access and ID tokens.
 */
export interface RefreshTokensConfig {
  clientId?: string;
  environment?: KrdpassEnvironment;
  refreshToken: string;
  scope?: string;
}

/**
 * Configuration for revokeToken call.
 * Invalidates an access or refresh token at the authorization server.
 */
export interface RevokeTokenConfig {
  clientId?: string;
  environment?: KrdpassEnvironment;
  token: string;
  tokenTypeHint?: "access_token" | "refresh_token";
}

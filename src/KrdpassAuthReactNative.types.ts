/** Which KRDPASS deployment the SDK talks to. */
export type KrdpassEnvironment = "production" | "development";

/**
 * The KRDPASS web URL for the environment, surfaced as `installUrl` on
 * `provider_not_installed` so callers can open the app store install page.
 */
export function installUrlFor(
  environment: KrdpassEnvironment = "production",
): string {
  return environment === "production"
    ? "https://app.pass.krd"
    : "https://app.krdpass.dev.krd";
}

/** Canonical OAuth/OIDC scopes offered by KRDPASS. */
export const KrdpassScopes = {
  openid: "openid",
  profile: "profile",
  citizen_identity: "citizen_identity",
  offline_access: "offline_access",
} as const;

/** Canonical user-facing messages, byte-identical across all four KRDPASS SDKs. */
export const KrdpassMessages = {
  CANCELLED: "Authentication was cancelled",
  TIMEOUT: "Authentication timed out",
  BUSY: "Another authentication is already in progress",
  STATE_MISMATCH:
    "State parameter mismatch: possible CSRF or response injection",
  ISSUER_MISMATCH:
    "Issuer mismatch: the response did not come from the expected authorization server",
  PROVIDER_NOT_INSTALLED:
    "The KRDPASS app is not installed or could not be opened. Please install or update KRDPASS.",
  NO_CODE: "No authorization code received",
  INVALID_REDIRECT: "Redirect URI does not match the exact configured endpoint",
  MISSING_ID_TOKEN: "Token response did not include an id_token",
  NONCE_MISMATCH: "ID token nonce mismatch (possible token replay)",
  STATE_REQUIRED:
    "state is required and cannot be blank. Pass the state returned by your backend's PAR call, or use signIn().",
} as const;

/**
 * Maps a wire error code to its canonical user-facing message, or undefined for
 * codes without one (the caller keeps the server-provided description).
 */
export function messageForErrorCode(code: string): string | undefined {
  if (CANCELLATION_CODES.has(code)) return KrdpassMessages.CANCELLED;
  switch (code) {
    case "timeout":
      return KrdpassMessages.TIMEOUT;
    case "busy":
      return KrdpassMessages.BUSY;
    case "state_mismatch":
      return KrdpassMessages.STATE_MISMATCH;
    // Security failures keep their own messages so a mix-up attack (RFC 9207) or a token
    // replay never reads as a cancel or as CSRF.
    case "issuer_mismatch":
      return KrdpassMessages.ISSUER_MISMATCH;
    case "nonce_mismatch":
      return KrdpassMessages.NONCE_MISMATCH;
    // invalid_id_token is deliberately absent: the cores emit it with dynamic text, and a
    // canonical string would throw away the only diagnostic.
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
 * Configuration for the client-only {@link signIn} flow. clientId, redirectUri
 * and environment come from {@link initialize} and cannot be overridden per call.
 */
export interface SignInConfig {
  scopes?: string | string[];
  /** Optional authentication timeout in seconds. */
  timeout?: number;
}

export interface InitializeConfig {
  clientId: string;
  redirectUri: string;
  environment?: KrdpassEnvironment;
}

/**
 * Token result from successful authentication. `receivedAt` is stamped locally
 * on receipt (epoch ms), not read from the server JSON, so
 * {@link KrdpassTokenResult.isExpired} can be computed on-device.
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
   * (default 60s). Fails closed: an unknown lifetime (non-finite expiresIn)
   * reads as expired. Safe to detach from the result and pass as a callback.
   */
  isExpired(skewSeconds?: number): boolean;
}

/**
 * Wrap a raw token map from the native bridge (or your backend's token JSON)
 * into a {@link KrdpassTokenResult}, stamping `receivedAt` and attaching isExpired.
 * A supplied `receivedAt` is honored: re-wrapping a stored token must not reset
 * the expiry clock.
 */
export function makeTokenResult(
  raw: Omit<KrdpassTokenResult, "receivedAt" | "isExpired"> & {
    receivedAt?: number;
  },
): KrdpassTokenResult {
  const receivedAt = raw.receivedAt ?? Date.now();
  // Read off the closure, not `this`: a detached isExpired has no receiver in a strict ES
  // module, so `this.expiresIn` would throw.
  const expiresIn = raw.expiresIn;
  return {
    accessToken: raw.accessToken,
    // The bridges emit JSON null for an absent optional (Android putNull, iOS NSNull) but the
    // declared type says `?: string`. Coerce so the runtime value matches the published .d.ts.
    idToken: raw.idToken ?? undefined,
    refreshToken: raw.refreshToken ?? undefined,
    expiresIn,
    tokenType: raw.tokenType,
    scope: raw.scope ?? undefined,
    receivedAt,
    isExpired(skewSeconds = 60): boolean {
      // Fail closed: with a non-finite expiresIn, `Date.now() >= NaN` is false, i.e. fresh
      // forever. Unknown lifetime must read as expired.
      if (!Number.isFinite(expiresIn)) return true;
      const expiresAt = receivedAt + expiresIn * 1000;
      return Date.now() >= expiresAt - skewSeconds * 1000;
    },
  };
}

/** Verified JWT claims returned by verifyToken. */
export type TokenClaims = Record<string, unknown>;

/**
 * User information claims returned by {@link getUserInfo}: the standard OpenID
 * Connect claims plus the KRDPASS citizen claims. Unmapped claims stay on `raw`.
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
  /**
   * Historical UPNs (previous values of `upn`). Must be stored; must never be
   * displayed. Empty array when the claim is absent.
   */
  upns: string[];
  did?: string;
  /** Full citizen name assembled from the known parts, if any. */
  citizenFullName?: string;
  /** Raw claims map from the UserInfo endpoint (for custom/non-standard fields). */
  raw: Record<string, unknown>;
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  /** PKCE challenge method: always "S256". */
  method: "S256";
}

/** Success result from a server-mediated authenticate call. */
export interface AuthResultSuccess {
  code: string;
  state?: string;
}

/**
 * Canonical auth error codes, applied to {@link AuthResultError.error} and
 * {@link KrdpassAuthError.code} as `AuthErrorCode | (string & {})` so the declared
 * codes autocomplete while a forwarded server/native code still type-checks.
 *
 * The OAuth cancellation aliases (`user_cancelled`, `access_denied`, `login_required`,
 * `consent_denied`) are deliberately not members: both cores rewrite them to `cancelled`
 * before returning, so declaring them invites branching on a case that never fires.
 * isAuthResultCancelled still accepts them defensively.
 */
export type AuthErrorCode =
  | "cancelled"
  | "timeout"
  | "busy"
  | "state_mismatch"
  | "issuer_mismatch"
  | "nonce_mismatch"
  | "invalid_id_token"
  | "invalid_redirect"
  | "invalid_request"
  | "request_expired"
  | "launch_failed"
  | "provider_not_installed"
  | "no_code"
  | "network_error"
  // The core fails closed when it cannot generate a secure PKCE pair.
  | "pkce_generation_failed"
  // Per-call permanent failures (4xx, malformed response), not retryable. Same strings as the
  // Android/iOS/Flutter SDKs.
  | "user_info_failed"
  | "refresh_failed"
  | "revoke_failed"
  | "verification_failed"
  // This package's own fallback when a native signIn rejection carries no code.
  | "authentication_failed"
  | "platform_error";

export interface AuthResultErrorBase {
  /** The wire error code. */
  error: AuthErrorCode | (string & {});
  /**
   * User-facing description. For a code with a canonical cross-SDK message this
   * is that message, NOT the server's text.
   */
  errorDescription?: string;
  /**
   * The untouched description from CAS or the native core. Log this: the canonical
   * message collapses every cancellation code onto one string, so the actual reason
   * only survives here. Undefined when neither side supplied one.
   */
  rawDescription?: string;
}

// The OAuth aliases are defensive: both cores canonicalize them to "cancelled" first.
export type AuthResultCancelled = AuthResultErrorBase & {
  error:
    | "cancelled"
    | "user_cancelled"
    | "access_denied"
    | "login_required"
    | "consent_denied";
};

export type AuthResultTimeout = AuthResultErrorBase & { error: "timeout" };

export type AuthResultBusy = AuthResultErrorBase & { error: "busy" };

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

export type AuthResultError =
  | AuthResultCancelled
  | AuthResultTimeout
  | AuthResultBusy
  | AuthResultProviderNotInstalled
  | AuthResultPlatformError
  | AuthResultErrorGeneric;

/** Result from a server-mediated authenticate call. */
export type AuthResult = AuthResultSuccess | AuthResultError;

export function isAuthResultSuccess(r: AuthResult): r is AuthResultSuccess {
  return "code" in r && !("error" in r);
}

export function isAuthResultError(r: AuthResult): r is AuthResultError {
  return "error" in r;
}

/**
 * Wire codes that classify a result as a user cancellation, matching the other
 * SDKs: the OAuth-level "user declined / re-auth required" responses surface as cancels.
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
 * Error thrown by the client-only {@link signIn} flow when authentication fails
 * or is cancelled. `code` is one of {@link AuthErrorCode} or a forwarded
 * server/native error string, so callers can branch on the failure. Mirrors the
 * throwing contract of the iOS/Android/Flutter SDKs.
 */
export class KrdpassAuthError extends Error {
  readonly code: AuthErrorCode | (string & {});
  readonly errorDescription?: string;
  /** The KRDPASS install URL when `code` is `provider_not_installed`; undefined otherwise. */
  readonly installUrl?: string;
  /** The untouched native/server description. See {@link AuthResultErrorBase.rawDescription}. */
  readonly rawDescription?: string;

  constructor(
    code: AuthErrorCode | (string & {}),
    errorDescription?: string,
    installUrl?: string,
    rawDescription?: string,
  ) {
    super(errorDescription ?? code);
    this.name = "KrdpassAuthError";
    this.code = code;
    this.errorDescription = errorDescription;
    this.installUrl = installUrl;
    this.rawDescription = rawDescription;
    // Restore the prototype chain (transpilation to ES5 otherwise breaks instanceof).
    Object.setPrototypeOf(this, KrdpassAuthError.prototype);
  }
}

/** Configuration for a server-mediated authenticate call. */
export interface AuthenticateConfig {
  requestUri: string;
  /**
   * The state your backend bound to the PAR request. Required: the SDK fails the
   * flow closed without it, since CSRF validation cannot be skipped.
   */
  state: string;
  /** Optional authentication timeout in seconds; native SDK defaults apply when omitted. */
  timeout?: number;
}

/** Configuration for verifyToken: validates the ID token signature via JWKS. */
export interface VerifyTokenConfig {
  idToken: string;
  /** Allowed clock skew in seconds for exp/nbf/iat checks. Defaults to 60. */
  clockSkew?: number;
}

export interface GetUserInfoConfig {
  accessToken: string;
}

export interface RefreshTokensConfig {
  refreshToken: string;
  scope?: string;
}

/** Configuration for revokeToken: invalidates a token at the authorization server. */
export interface RevokeTokenConfig {
  token: string;
  tokenTypeHint?: "access_token" | "refresh_token";
}

import { Linking, Platform } from "react-native";

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
  AuthResultPlatformError,
  AuthResultProviderNotInstalled,
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
 * Initialize the SDK with global configuration. Call once at app startup;
 * clientId, redirectUri and environment are stored and used for all subsequent
 * calls and cannot be overridden per call.
 */
export function initialize(config: InitializeConfig): void {
  _storedConfig = {
    clientId: assertNonEmpty(config.clientId, "clientId"),
    redirectUri: assertHttpsRedirectUri(config.redirectUri),
    environment: assertEnvironment(config.environment),
  };
}

/** Throws if {@link initialize} has not been called, matching the Android/Flutter SDKs. */
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
// allowed host, and rejects a fragment outright (RFC 6749 section 3.1.2 forbids one here).
// A regex, not `new URL()`: React Native polyfills global URL with a non-validating class, so
// WHATWG parsing gives a different answer on device than under Node.
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

// Validated at initialize(): the value usually arrives from an env var through a cast, and an
// unrecognized one would otherwise fail natively long after the mistake was made.
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

// On iOS, forward the `url` Linking event to the native module for the duration of `fn`.
// Android completes the redirect via onActivityResult and needs no listener.
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
 * Run a native call and normalize any rejection into a {@link KrdpassAuthError}.
 * `fallbackCode` applies only when the rejection carries no structured code (`e.code`),
 * so a transient network_error is never reported as a permanent per-call failure. The
 * underlying message always survives on rawDescription. Local argument validation stays
 * outside this wrapper and throws a plain Error, not a wire-coded one.
 */
async function callNative<T>(
  fallbackCode: AuthErrorCode,
  environment: KrdpassEnvironment | undefined,
  call: () => Promise<unknown>,
): Promise<T> {
  try {
    // The bridge is typed UnsafeObject; the shape is asserted once here, T named at the call site.
    return (await call()) as T;
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
 * Sign in with KRDPASS using client-only (direct) mode: the complete OAuth flow
 * against CAS with no backend server. Generates PKCE internally, pushes the
 * authorization request, launches KRDPASS, and exchanges the code for tokens.
 * Throws {@link KrdpassAuthError} when authentication fails or is cancelled.
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
    // Blank means "not supplied", so signIn({ scopes: [] }) reaches the platform defaults
    // instead of asking for the empty scope set.
    const joined = Array.isArray(config.scopes)
      ? config.scopes.join(" ")
      : config.scopes;
    const scopes = joined?.trim() ? joined : undefined;
    const native = await callNative<KrdpassTokenResult>(
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
    );
    return makeTokenResult(native);
  });
}

/** Get user information from CAS using an access token (raw claims on `.raw`). */
export async function getUserInfo(
  config: GetUserInfoConfig,
): Promise<KrdpassUserInfo> {
  const resolved = resolveConfig();
  const accessToken = assertNonEmpty(config.accessToken, "accessToken");
  const raw = await callNative<Record<string, unknown>>(
    "user_info_failed",
    resolved.environment,
    () =>
      KrdpassAuthReactNativeModule.getUserInfo({
        clientId: resolved.clientId,
        accessToken,
        environment: resolved.environment,
      }),
  );
  return mapUserInfo(raw);
}

// A blank claim means "not provided" and reads as undefined, never as "", matching Android's
// `takeIf { it.isNotBlank() }`. The value that survives is the untrimmed original.
const claimString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const claimStringArray = (value: unknown): string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string")
    ? value
    : [];

/** Map the raw snake_case UserInfo claims into the typed shape shared with the other SDKs. */
function mapUserInfo(raw: Record<string, unknown>): KrdpassUserInfo {
  // sub is the only claim read without the blank filter: an empty sub fails the parse, while a
  // whitespace-only one is kept, matching the other three SDKs.
  const sub = typeof raw.sub === "string" ? raw.sub : "";
  if (!sub) {
    throw new Error("Invalid user info response: missing or empty sub field");
  }
  // Each part is trimmed before joining so a padded or whitespace-only claim never leaves a
  // stray space in the joined name, matching the other SDKs.
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

/** Exchange a refresh token for new access and ID tokens. */
export async function refreshTokens(
  config: RefreshTokensConfig,
): Promise<KrdpassTokenResult> {
  const resolved = resolveConfig();
  const refreshToken = assertNonEmpty(config.refreshToken, "refreshToken");
  const native = await callNative<KrdpassTokenResult>(
    "refresh_failed",
    resolved.environment,
    () =>
      KrdpassAuthReactNativeModule.refreshTokens({
        clientId: resolved.clientId,
        refreshToken,
        environment: resolved.environment,
        ...(config.scope !== undefined ? { scope: config.scope } : {}),
      }),
  );
  return makeTokenResult(native);
}

/** Revoke an access or refresh token at the authorization server. */
export async function revokeToken(config: RevokeTokenConfig): Promise<void> {
  const resolved = resolveConfig();
  const token = assertNonEmpty(config.token, "token");
  await callNative("revoke_failed", resolved.environment, () =>
    KrdpassAuthReactNativeModule.revokeToken({
      clientId: resolved.clientId,
      token,
      environment: resolved.environment,
      ...(config.tokenTypeHint !== undefined
        ? { tokenTypeHint: config.tokenTypeHint }
        : {}),
    }),
  );
}

/**
 * Verify an ID token via JWKS: RS256 signature, pinned issuer and audience, and
 * the exp/nbf/iat claims within `clockSkew`. The one check this call cannot make
 * is nonce binding, which only exists inside a flow that generated a nonce; the
 * client-only {@link signIn} flow runs all of the above plus that check.
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
  return callNative<TokenClaims>("verification_failed", resolved.environment, () =>
    KrdpassAuthReactNativeModule.verifyToken({
      clientId: resolved.clientId,
      idToken,
      clockSkew,
      environment: resolved.environment,
    }),
  );
}

/** Generate a PKCE code verifier and challenge pair for server-mediated flows. */
export async function generatePkcePair(): Promise<PkcePair> {
  // No resolveConfig(): a PKCE pair needs no client config, so this stays callable before
  // initialize().
  const { codeVerifier, codeChallenge } = await callNative<{
    codeVerifier: string;
    codeChallenge: string;
  }>("pkce_generation_failed", undefined, () =>
    KrdpassAuthReactNativeModule.generatePkcePair(),
  );
  // KRDPASS always uses S256; surface it so callers don't hardcode the method.
  return { codeVerifier, codeChallenge, method: "S256" };
}

// The one home of the error-resolution policy shared by callNative and authenticate.
// rawDescription always keeps the original native/server text; errorDescription prefers the
// canonical message. installUrl is derived locally and never crosses the bridge.
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

// Reconciles the snake_case keys the native modules emit (`error_description`) with the
// camelCase contract, in one place instead of a cast at every call site.
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
 * Launch KRDPASS authentication with a pre-obtained requestUri, for
 * server-mediated flows where your backend handles PAR and token exchange.
 * Always resolves to an {@link AuthResult}; it never throws.
 */
export async function authenticate(
  config: AuthenticateConfig,
): Promise<AuthResult> {
  return withIosUrlForwarding(async () => {
    // authenticate never throws, so a missing initialize() or bad argument has to arrive as an
    // AuthResult too. platform_error is what both natives resolve for the same input.
    let resolved: ReturnType<typeof resolveConfig>;
    try {
      resolved = resolveConfig();
    } catch (e) {
      return {
        error: "platform_error",
        errorDescription: e instanceof Error ? e.message : String(e),
      };
    }
    const requestUri = config.requestUri?.trim();
    if (!requestUri) {
      return {
        error: "platform_error",
        errorDescription: "requestUri is required",
      };
    }
    // Android rejects a blank state with isBlank() while iOS uses isEmpty, so "   " failed
    // closed on only one platform; decided here for both. Never trimmed on the way through:
    // the core must see the backend's PAR state byte-identical.
    if (config.state === undefined || config.state.trim().length === 0) {
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
    let result: AuthResult | (AuthResultError & { error_description?: string });
    try {
      result = (await KrdpassAuthReactNativeModule.authenticate({
        clientId: resolved.clientId,
        requestUri,
        redirectUri: resolved.redirectUri,
        environment: resolved.environment,
        state: config.state,
        ...(timeout !== undefined ? { timeout } : {}),
      })) as AuthResult | (AuthResultError & { error_description?: string });
    } catch (e) {
      // A native rejection has to arrive as an AuthResult too, with the same normalization
      // the resolved error path gets.
      return normalizeNativeError(
        {
          error: (e as { code?: string } | null)?.code ?? "platform_error",
          errorDescription: e instanceof Error ? e.message : undefined,
        },
        resolved.environment,
      );
    }
    if (isAuthResultError(result)) {
      return normalizeNativeError(result, resolved.environment);
    }
    // Fail closed: a success carrying no code is not a success.
    if (!result.code) {
      return { error: "no_code", errorDescription: KrdpassMessages.NO_CODE };
    }
    // `?? undefined`: both bridges emit JSON null for an absent state (Android putNull, iOS
    // NSNull) but AuthResultSuccess declares `state?: string`. Rebuilt, not spread.
    return { code: result.code, state: result.state ?? undefined };
  });
}

/**
 * Cancel an in-flight authentication attempt, e.g. when the app returns to
 * foreground without receiving a callback. `timeout: true` finishes the pending
 * flow as a timeout instead of a cancellation. Returns true when a flow was
 * pending, false when there was nothing to cancel.
 */
export async function cancelPendingAuthentication(options?: {
  timeout?: boolean;
}): Promise<boolean> {
  // No resolveConfig(): cancelling needs no client config, so this stays callable before
  // initialize().
  return callNative<boolean>("platform_error", _storedConfig?.environment, () =>
    KrdpassAuthReactNativeModule.cancelAuthentication({
      timeout: options?.timeout ?? false,
    }),
  );
}

/**
 * Generate a cryptographically secure base64url state parameter for OAuth state
 * validation in server-mediated flows.
 */
export function generateState(): string {
  const randomBytes = new Uint8Array(32);
  // Loaded here rather than at module scope, so an app that never calls this does not pay for
  // the polyfill or have to install it.
  try {
    require("react-native-get-random-values");
  } catch {
    // Not installed. The check below says what to do about it.
  }
  const cryptoObj = (globalThis as { crypto?: RandomSource }).crypto;
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
declare function require(moduleName: string): unknown;

/** The one thing generateState needs from `globalThis.crypto`. */
type RandomSource = { getRandomValues(array: Uint8Array): Uint8Array };

/**
 * Decode a JWT's claims WITHOUT verifying its signature.
 *
 * SECURITY: the returned claims are NOT authenticated and MUST NOT drive any
 * trust or authorization decision. Always use {@link verifyToken} first; this is
 * only for cosmetic display of an already-verified token.
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

import { Linking, Platform } from 'react-native';
import 'react-native-get-random-values';
import {
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
  AuthResultStateMismatch,
  AuthResultSuccess,
  AuthResultTimeout,
  AuthenticateConfig,
  GetUserInfoConfig,
  InitializeConfig,
  KrdpassConfig,
  KrdpassEnvironment,
  KrdpassTokenResult,
  PkcePair,
  RefreshTokensConfig,
  RevokeTokenConfig,
  TokenClaims,
  VerifyTokenConfig,
  isAuthResultBusy,
  isAuthResultCancelled,
  isAuthResultError,
  isAuthResultSuccess,
  isAuthResultTimeout,
} from './KrdpassAuthReactNative.types';
import KrdpassAuthReactNativeModule from './KrdpassAuthReactNativeModule';

export {
  AuthErrorCode,
  AuthResult,
  AuthResultBusy,
  AuthResultCancelled,
  AuthResultError,
  AuthResultErrorBase,
  AuthResultErrorGeneric,
  AuthResultInvalidRedirect,
  AuthResultLaunchFailed,
  AuthResultPlatformError, AuthResultStateMismatch, AuthResultSuccess, AuthResultTimeout,
  AuthenticateConfig,
  GetUserInfoConfig,
  InitializeConfig,
  KrdpassConfig,
  KrdpassEnvironment,
  KrdpassTokenResult,
  PkcePair,
  RefreshTokensConfig,
  RevokeTokenConfig,
  TokenClaims,
  VerifyTokenConfig,
  isAuthResultBusy,
  isAuthResultCancelled,
  isAuthResultError,
  isAuthResultSuccess,
  isAuthResultTimeout
};

// ---------------------------------------------------------------------------
// Stored configuration (set via initialize())
// ---------------------------------------------------------------------------
let _storedConfig: InitializeConfig | null = null;

/**
 * Initialize the SDK with global configuration.
 *
 * Call this once at app startup. After initialization, clientId, redirectUri,
 * and environment are stored and used as defaults for all subsequent calls
 * (authenticate, signIn, getUserInfo, etc.).
 *
 * You can still override any value per-call if needed.
 *
 * @param config - clientId, redirectUri, and optional environment
 */
export function initialize(config: InitializeConfig): void {
  _storedConfig = {
    clientId: assertNonEmpty(config.clientId, 'clientId'),
    redirectUri: assertHttpsRedirectUri(config.redirectUri),
    environment: config.environment,
  };
}

/**
 * Resolve clientId/redirectUri/environment from per-call overrides merged
 * with stored config. Throws if a required value is missing from both.
 */
function resolveConfig(override?: {
  clientId?: string;
  redirectUri?: string;
  environment?: KrdpassEnvironment;
}): { clientId: string; redirectUri: string; environment: KrdpassEnvironment } {
  const clientId = override?.clientId ?? _storedConfig?.clientId;
  const redirectUri = override?.redirectUri ?? _storedConfig?.redirectUri;
  const environment = override?.environment ?? _storedConfig?.environment;
  return {
    clientId: assertNonEmpty(clientId, 'clientId (call initialize() first or pass directly)'),
    redirectUri: assertHttpsRedirectUri(
      assertNonEmpty(redirectUri, 'redirectUri (call initialize() first or pass directly)'),
    ),
    environment: environment ?? 'production',
  };
}



const HTTPS_REDIRECT_URI_REGEX =
  /^https:\/\/[^/\s?#]+(?::\d{1,5})?(?:[/?#].*)?$/i;

const assertNonEmpty = (value: string | undefined, field: string): string => {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
};

const assertHttpsRedirectUri = (redirectUri: string): string => {
  const normalized = assertNonEmpty(redirectUri, 'redirectUri');
  if (!HTTPS_REDIRECT_URI_REGEX.test(normalized)) {
    throw new Error('redirectUri must be a valid HTTPS URL');
  }
  return normalized;
};

/**
 * Sign in with KrdPass using client-only (direct) mode.
 *
 * This method handles the complete OAuth flow directly with CAS,
 * without requiring a backend server. It generates PKCE internally,
 * pushes the authorization request, launches KrdPass, and exchanges
 * the code for tokens.
 *
 * @param config - Configuration including clientId, redirectUri, and optional scopes
 * @returns Promise resolving to tokens (accessToken, idToken, refreshToken, etc.)
 * @throws Error if authentication fails or is cancelled
 */
export async function signIn(config: KrdpassConfig): Promise<KrdpassTokenResult> {
  let sub: ReturnType<typeof Linking.addEventListener> | undefined;
  if (Platform.OS === 'ios') {
    sub = Linking.addEventListener('url', ({ url }) => {
      KrdpassAuthReactNativeModule.handleURL?.(url);
    });
  }

  try {
    const resolved = resolveConfig(config);
    const scopes =
      Array.isArray(config.scopes) ? config.scopes.join(' ') : config.scopes;
    return (await KrdpassAuthReactNativeModule.signIn({
      ...config,
      clientId: resolved.clientId,
      redirectUri: resolved.redirectUri,
      environment: resolved.environment,
      ...(scopes ? { scopes } : {}),
    })) as KrdpassTokenResult;
  } finally {
    sub?.remove();
  }
}

/**
 * Get user information from CAS using an access token.
 *
 * @param config - Configuration including accessToken
 * @returns Promise resolving to user info claims
 */
export async function getUserInfo(config: GetUserInfoConfig): Promise<TokenClaims> {
  const resolved = resolveConfig(config);
  const accessToken = assertNonEmpty(config.accessToken, 'accessToken');
  return (await KrdpassAuthReactNativeModule.getUserInfo({
    ...config,
    clientId: resolved.clientId,
    accessToken,
    environment: resolved.environment,
  })) as TokenClaims;
}

/**
 * Refresh tokens using a refresh token.
 *
 * @param config - Configuration including refreshToken
 * @returns Promise resolving to new tokens
 */
export async function refreshTokens(config: RefreshTokensConfig): Promise<KrdpassTokenResult> {
  const resolved = resolveConfig(config);
  const refreshToken = assertNonEmpty(config.refreshToken, 'refreshToken');
  return (await KrdpassAuthReactNativeModule.refreshTokens({
    ...config,
    clientId: resolved.clientId,
    refreshToken,
    environment: resolved.environment,
  })) as KrdpassTokenResult;
}

/**
 * Revoke an access or refresh token.
 *
 * @param config - Configuration including token to revoke
 */
export async function revokeToken(config: RevokeTokenConfig): Promise<void> {
  const resolved = resolveConfig(config);
  const token = assertNonEmpty(config.token, 'token');
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
 * - Token expiration (exp claim)
 * - Token not-before (nbf claim)
 * - Token issued-at (iat claim)
 *
 * @param config - Configuration including idToken to verify
 * @returns Promise resolving to verified token claims
 * @throws Error if token signature is invalid or claims fail validation
 */
export async function verifyToken(config: VerifyTokenConfig): Promise<TokenClaims> {
  const resolved = resolveConfig(config);
  const idToken = assertNonEmpty(config.idToken, 'idToken');
  return (await KrdpassAuthReactNativeModule.verifyToken({
    ...config,
    clientId: resolved.clientId,
    idToken,
    environment: resolved.environment,
  })) as TokenClaims;
}

/**
 * Generate a PKCE code verifier and challenge pair.
 * Use this for server-mediated authentication flows.
 */
export async function generatePkcePair(): Promise<PkcePair> {
  return await KrdpassAuthReactNativeModule.generatePkcePair();
}

/**
 * Launch KrdPass authentication with a pre-obtained requestUri.
 * Use this for server-mediated authentication flows where your backend
 * handles PAR and token exchange.
 * 
 * @param config - Authentication configuration including requestUri from backend
 * @returns AuthResult with code and state for backend token exchange
 */
export async function authenticate(config: AuthenticateConfig): Promise<AuthResult> {
  let sub: ReturnType<typeof Linking.addEventListener> | undefined;
  if (Platform.OS === 'ios') {
    sub = Linking.addEventListener('url', ({ url }) => {
      KrdpassAuthReactNativeModule.handleURL?.(url);
    });
  }

  try {
    const resolved = resolveConfig(config);
    const requestUri = assertNonEmpty(config.requestUri, 'requestUri');
    const timeout =
      config.timeout === undefined ? undefined : Number(config.timeout);
    if (timeout !== undefined) {
      if (!Number.isFinite(timeout) || timeout <= 0) {
        return {
          error: 'platform_error',
          errorDescription: 'timeout must be a positive number of seconds',
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
    })) as
      | AuthResult
      | (AuthResultError & { error_description?: string });
    if (isAuthResultError(result)) {
      const errorDescription = result.errorDescription ?? (result as { error_description?: string }).error_description;
      return { error: result.error, errorDescription };
    }
    return result;
  } finally {
    sub?.remove();
  }
}

/**
 * Cancel an in-flight authentication attempt.
 *
 * This is useful when the app returns to foreground without receiving a callback.
 */
export async function cancelPendingAuthentication(options?: {
  timeout?: boolean;
}): Promise<void> {
  if (!KrdpassAuthReactNativeModule.cancelAuthentication) {
    return;
  }
  await KrdpassAuthReactNativeModule.cancelAuthentication({
    timeout: options?.timeout ?? false,
  });
}


/**
 * Build the KRDPass authorization URL for server-mediated flow.
 * Requires clientId, redirectUri, and environment from config.
 */
export function buildAuthorizationUrl(options: {
  requestUri: string;
  state?: string;
  clientId?: string;
  redirectUri?: string;
  environment?: KrdpassEnvironment;
}): string {
  const resolved = resolveConfig(options);
  const requestUri = assertNonEmpty(options.requestUri, 'requestUri');
  const baseUrl = resolved.environment === 'production'
    ? 'https://app.pass.krd/connect/authorize'
    : 'https://app.krdpass.dev.krd/connect/authorize';
  const params = new URLSearchParams({
    client_id: resolved.clientId,
    request_uri: requestUri,
    redirect_uri: resolved.redirectUri,
  });
  if (options.state) params.set('state', options.state);
  return `${baseUrl}?${params.toString()}`;
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
      'Secure random generator unavailable. Install and initialize react-native-get-random-values.',
    );
  }
  cryptoObj.getRandomValues(randomBytes);

  // Convert to base64 using btoa helper
  let binary = '';
  randomBytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  // Base64url encode (no padding)
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// btoa polyfill for React Native
const btoa = (input: string): string => {
  const btoaChars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i);
    const b = input.charCodeAt(i + 1);
    const c = input.charCodeAt(i + 2);
    const index1 = a >> 2;
    const index2 = ((a & 3) << 4) | (b >> 4);
    const index3 = ((b & 15) << 2) | (c >> 6);
    const index4 = c & 63;
    output +=
      btoaChars[index1] +
      btoaChars[index2] +
      (isNaN(b) ? '=' : btoaChars[index3]) +
      (isNaN(c) ? '=' : btoaChars[index4]);
  }
  return output;
};

// Polyfill for atob
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const atob = (input: string) => {
  let str = input.replace(/=+$/, '');
  let output = '';

  if (str.length % 4 == 1) {
    throw new Error("'atob' failed: The string to be decoded is not correctly encoded.");
  }
  for (let bc = 0, bs = 0, buffer, i = 0;
    (buffer = str.charAt(i++));
    ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer,
      bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0
  ) {
    buffer = chars.indexOf(buffer);
  }

  return output;
};

/**
 * Decode a JWT's claims WITHOUT verifying its signature.
 *
 * ⚠️ SECURITY: the returned claims are NOT authenticated and MUST NOT drive any
 * trust or authorization decision. Always use {@link verifyToken} first; this is
 * only for cosmetic display of an already-verified token.
 *
 * @param token - The JWT token to decode
 * @returns The decoded payload claims
 * @throws Error if the token is not a parseable JWT
 */
export function decodeTokenUnverified(token: string): TokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Not a valid JWT: expected three parts');
  }
  try {
    const decoded = atob(base64UrlToBase64(parts[1]));
    return JSON.parse(decoded) as TokenClaims;
  } catch (e) {
    throw new Error(`Not a valid JWT payload: ${String(e)}`);
  }
}

const base64UrlToBase64 = (input: string): string => {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4;
  if (padding > 0) {
    base64 = base64.padEnd(base64.length + (4 - padding), '=');
  }
  return base64;
};

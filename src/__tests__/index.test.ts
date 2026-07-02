import KrdpassAuthReactNativeModule from "../KrdpassAuthReactNativeModule";
import {
  authenticate,
  decodeTokenUnverified,
  generateState,
  getUserInfo,
  initialize,
  isAuthResultBusy,
  isAuthResultCancelled,
  isAuthResultError,
  isAuthResultSuccess,
  isAuthResultTimeout,
  KrdpassAuthError,
  KrdpassMessages,
  KrdpassScopes,
  refreshTokens,
  revokeToken,
  signIn,
  verifyToken,
} from "../index";
// messageForErrorCode is internal (not part of the public surface), so import it from its module.
import { messageForErrorCode } from "../KrdpassAuthReactNative.types";

// Pure-logic unit tests: mock the RN surface the module imports at load time.
// (ts-jest hoists these jest.mock calls above the imports above.)
jest.mock("react-native", () => ({
  Linking: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: { OS: "ios" },
  NativeModules: {},
}));
// The native module self-loads on import (and throws off-device), so mock it.
jest.mock("../KrdpassAuthReactNativeModule", () => ({
  __esModule: true,
  default: {
    signIn: jest.fn(),
    authenticate: jest.fn(),
    getUserInfo: jest.fn(),
    refreshTokens: jest.fn(),
    revokeToken: jest.fn(),
    verifyToken: jest.fn(),
    handleURL: jest.fn(),
    cancelAuthentication: jest.fn(),
  },
}));
jest.mock("react-native-get-random-values", () => ({}));

/** base64url-encode a JSON object the way a JWT payload segment is encoded. */
function encodeSegment(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("generateState", () => {
  it("returns a URL-safe base64url token", () => {
    const state = generateState();
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(state.length).toBeGreaterThanOrEqual(43); // 32 bytes, no padding
  });

  it("is unique across calls", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toEqual(b);
  });
});

describe("decodeTokenUnverified", () => {
  it("decodes JWT claims", () => {
    const token = `header.${encodeSegment({
      sub: "123",
      scope: "openid",
    })}.sig`;
    const claims = decodeTokenUnverified(token);
    expect(claims.sub).toBe("123");
    expect(claims.scope).toBe("openid");
  });

  it("preserves non-ASCII (Kurdish/Arabic) claims as UTF-8", () => {
    const name = "ئارین کابان";
    const token = `header.${encodeSegment({ name })}.sig`;
    expect(decodeTokenUnverified(token).name).toBe(name);
  });

  it("throws when the token is not three parts", () => {
    expect(() => decodeTokenUnverified("only.two")).toThrow();
  });

  it("throws on an unparseable payload", () => {
    expect(() => decodeTokenUnverified("header.!!!notbase64!!!.sig")).toThrow();
  });
});

// Canonical messages must be BYTE-IDENTICAL across all four SDKs.
describe("canonical messages parity", () => {
  it("matches the cross-SDK canonical strings verbatim", () => {
    expect(KrdpassMessages).toEqual({
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
    });
  });


  it("maps wire error codes to canonical messages", () => {
    expect(messageForErrorCode("cancelled")).toBe(KrdpassMessages.CANCELLED);
    expect(messageForErrorCode("state_mismatch")).toBe(
      KrdpassMessages.STATE_MISMATCH,
    );
    expect(messageForErrorCode("provider_not_installed")).toBe(
      KrdpassMessages.PROVIDER_NOT_INSTALLED,
    );
    expect(messageForErrorCode("some_server_code")).toBeUndefined();
  });
});

describe("KrdpassScopes constants", () => {
  it("exposes the canonical scope strings", () => {
    expect(KrdpassScopes).toEqual({
      openid: "openid",
      profile: "profile",
      citizen_identity: "citizen_identity",
      offline_access: "offline_access",
    });
  });
});

describe("initialize redirectUri validation", () => {
  it("rejects a non-HTTPS redirectUri", () => {
    expect(() =>
      initialize({ clientId: "c", redirectUri: "http://insecure.example.com" }),
    ).toThrow(/HTTPS/i);
  });

  it("accepts a valid HTTPS redirectUri", () => {
    expect(() =>
      initialize({ clientId: "c", redirectUri: "https://app.example.com/cb" }),
    ).not.toThrow();
  });
});

describe("signIn config fallback (parity with iOS/Android/Flutter)", () => {
  it("uses stored clientId/redirectUri when signIn is called with only scopes", async () => {
    const nativeSignIn = KrdpassAuthReactNativeModule.signIn as jest.Mock;
    nativeSignIn.mockResolvedValue({
      accessToken: "at",
      tokenType: "Bearer",
      expiresIn: 3600,
    });
    initialize({
      clientId: "stored-client",
      redirectUri: "https://app.example.com/cb",
    });

    const tokens = await signIn({ scopes: ["openid", "profile"] });

    expect(tokens.accessToken).toBe("at");
    expect(nativeSignIn).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "stored-client",
        redirectUri: "https://app.example.com/cb",
        scopes: "openid profile",
      }),
    );
  });
});

describe("auth result type guards", () => {
  it("discriminates success vs error", () => {
    expect(isAuthResultSuccess({ code: "abc" })).toBe(true);
    expect(isAuthResultError({ code: "abc" })).toBe(false);
    expect(isAuthResultError({ error: "cancelled" })).toBe(true);
  });

  it("identifies specific error codes", () => {
    expect(isAuthResultCancelled({ error: "cancelled" })).toBe(true);
    expect(isAuthResultTimeout({ error: "timeout" })).toBe(true);
    expect(isAuthResultBusy({ error: "busy" })).toBe(true);
    expect(isAuthResultCancelled({ error: "timeout" })).toBe(false);
  });
});

describe("signIn error contract (throws like iOS/Android/Flutter)", () => {
  const nativeSignIn = () => KrdpassAuthReactNativeModule.signIn as jest.Mock;
  beforeEach(() => {
    initialize({ clientId: "c", redirectUri: "https://app.example.com/cb" });
  });

  // Both native modules REJECT the promise on failure, carrying the structured
  // code on the rejection (Expo CodedError shape). Mock that reality.
  const nativeRejection = (code: string, message: string) =>
    Object.assign(new Error(message), { code });

  it("throws a discriminable KrdpassAuthError when native rejects (cancel)", async () => {
    nativeSignIn().mockRejectedValue(
      nativeRejection("cancelled", "User cancelled authentication"),
    );
    const err = await signIn().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(KrdpassAuthError);
    expect((err as KrdpassAuthError).code).toBe("cancelled");
    // Known codes surface the canonical user-facing message.
    expect((err as KrdpassAuthError).errorDescription).toBe(
      KrdpassMessages.CANCELLED,
    );
  });

  it("throws (never resolves a fake token) on a CSRF state_mismatch", async () => {
    nativeSignIn().mockRejectedValue(
      nativeRejection("state_mismatch", "State parameter mismatch"),
    );
    const err = await signIn().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(KrdpassAuthError);
    expect((err as KrdpassAuthError).code).toBe("state_mismatch");
    expect((err as KrdpassAuthError).errorDescription).toBe(
      KrdpassMessages.STATE_MISMATCH,
    );
  });

  it("wraps a codeless native rejection as authentication_failed", async () => {
    nativeSignIn().mockRejectedValue(new Error("boom"));
    const err = await signIn().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(KrdpassAuthError);
    expect((err as KrdpassAuthError).code).toBe("authentication_failed");
    expect((err as KrdpassAuthError).errorDescription).toBe("boom");
  });

  it("returns the token result unchanged on success", async () => {
    nativeSignIn().mockResolvedValue({
      accessToken: "at",
      tokenType: "Bearer",
      expiresIn: 3600,
    });
    const tokens = await signIn();
    expect(tokens.accessToken).toBe("at");
  });
});

describe("signIn timeout validation", () => {
  beforeEach(() => {
    initialize({ clientId: "c", redirectUri: "https://app.example.com/cb" });
  });
  it.each([0, -5, NaN, Infinity])(
    "rejects a non-positive / non-finite timeout: %p",
    async (timeout) => {
      await expect(signIn({ timeout })).rejects.toThrow(/positive/i);
    },
  );
});

describe("authenticate()", () => {
  const nativeAuth = () =>
    KrdpassAuthReactNativeModule.authenticate as jest.Mock;
  beforeEach(() => {
    initialize({ clientId: "c", redirectUri: "https://app.example.com/cb" });
    nativeAuth().mockReset();
  });

  it("rejects a non-positive timeout WITHOUT calling native", async () => {
    const result = await authenticate({ requestUri: "urn:abc", timeout: 0 });
    // platform_error: the cross-SDK code for a bad local timeout argument.
    expect(result).toMatchObject({ error: "platform_error" });
    expect(nativeAuth()).not.toHaveBeenCalled();
  });

  it("surfaces the canonical message for a known wire code", async () => {
    nativeAuth().mockResolvedValue({
      error: "state_mismatch",
      error_description: "State did not match",
    });
    const result = await authenticate({ requestUri: "urn:abc" });
    expect(result).toEqual({
      error: "state_mismatch",
      errorDescription: KrdpassMessages.STATE_MISMATCH,
    });
  });

  it("falls back to the native description for an unknown code", async () => {
    nativeAuth().mockResolvedValue({
      error: "some_server_code",
      error_description: "Server says no",
    });
    const result = await authenticate({ requestUri: "urn:abc" });
    expect(result).toEqual({
      error: "some_server_code",
      errorDescription: "Server says no",
    });
  });

  it("passes a success result through unchanged", async () => {
    nativeAuth().mockResolvedValue({ code: "auth-code", state: "xyz" });
    const result = await authenticate({ requestUri: "urn:abc" });
    expect(isAuthResultSuccess(result)).toBe(true);
    expect(result).toEqual({ code: "auth-code", state: "xyz" });
  });
});

describe("config validation (stateful: config comes from initialize)", () => {
  it("initialize rejects a whitespace-only clientId", () => {
    expect(() =>
      initialize({
        clientId: "   ",
        redirectUri: "https://app.example.com/cb",
      }),
    ).toThrow(/clientId.*required/i);
  });

  it("defaults environment to production when unset", async () => {
    const nativeSignIn = KrdpassAuthReactNativeModule.signIn as jest.Mock;
    nativeSignIn.mockClear();
    nativeSignIn.mockResolvedValue({
      accessToken: "at",
      tokenType: "Bearer",
      expiresIn: 3600,
    });
    initialize({ clientId: "c", redirectUri: "https://app.example.com/cb" });
    await signIn({ scopes: ["openid"] });
    expect(nativeSignIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ environment: "production" }),
    );
  });
});

describe("required-field guards reject blank values", () => {
  beforeEach(() => {
    initialize({ clientId: "c", redirectUri: "https://app.example.com/cb" });
  });
  it("getUserInfo requires accessToken", async () => {
    await expect(getUserInfo({ accessToken: "  " })).rejects.toThrow(
      /accessToken.*required/i,
    );
  });
  it("refreshTokens requires refreshToken", async () => {
    await expect(refreshTokens({ refreshToken: "" })).rejects.toThrow(
      /refreshToken.*required/i,
    );
  });
  it("revokeToken requires token", async () => {
    await expect(revokeToken({ token: "   " })).rejects.toThrow(
      /token.*required/i,
    );
  });
  it("verifyToken requires idToken", async () => {
    await expect(verifyToken({ idToken: "" })).rejects.toThrow(
      /idToken.*required/i,
    );
  });
});

describe("getUserInfo maps raw claims to typed KrdpassUserInfo", () => {
  beforeEach(() => {
    initialize({ clientId: "c", redirectUri: "https://app.example.com/cb" });
  });

  it("maps snake_case -> camelCase, builds citizenFullName, keeps raw", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({
      sub: "user-1",
      given_name: "Arin",
      family_name: "Faraj",
      citizen_first: "Arin",
      citizen_surname: "Faraj",
      sex_at_birth: "male",
      custom_claim: "x",
    });
    const info = await getUserInfo({ accessToken: "at" });
    expect(info.sub).toBe("user-1");
    expect(info.givenName).toBe("Arin");
    expect(info.familyName).toBe("Faraj");
    expect(info.sexAtBirth).toBe("male");
    expect(info.citizenFullName).toBe("Arin Faraj");
    expect(info.raw.custom_claim).toBe("x");
  });

  it("throws when the response has no sub", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({ name: "no sub" });
    await expect(getUserInfo({ accessToken: "at" })).rejects.toThrow(/sub/i);
  });
});

describe("isAuthResultCancelled classifies the full cancellation set (parity)", () => {
  it.each([
    "cancelled",
    "user_cancelled",
    "access_denied",
    "login_required",
    "consent_denied",
  ])("returns true for %s", (code) => {
    expect(isAuthResultCancelled({ error: code })).toBe(true);
  });

  it("returns false for non-cancellation errors", () => {
    expect(isAuthResultCancelled({ error: "state_mismatch" })).toBe(false);
    expect(isAuthResultCancelled({ error: "timeout" })).toBe(false);
  });
});

describe("KrdpassTokenResult receivedAt + isExpired", () => {
  beforeEach(() => {
    initialize({ clientId: "c", redirectUri: "https://app.example.com/cb" });
  });

  it("stamps receivedAt locally and computes isExpired with skew", async () => {
    const nativeSignIn = KrdpassAuthReactNativeModule.signIn as jest.Mock;
    // Server JSON carries NO receivedAt; it must be stamped on-device.
    nativeSignIn.mockResolvedValue({
      accessToken: "at",
      tokenType: "Bearer",
      expiresIn: 3600,
    });
    const before = Date.now();
    const tokens = await signIn();
    const after = Date.now();

    expect(tokens.receivedAt).toBeGreaterThanOrEqual(before);
    expect(tokens.receivedAt).toBeLessThanOrEqual(after);
    expect(tokens.isExpired()).toBe(false); // fresh, 1h lifetime
    // A skew wider than the remaining lifetime treats the token as expired.
    expect(tokens.isExpired(3600 + 60)).toBe(true);
  });
});

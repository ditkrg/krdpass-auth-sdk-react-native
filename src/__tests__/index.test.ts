import {
  KrdpassMessages,
  messageForErrorCode,
  type AuthenticateConfig,
} from "../KrdpassAuthReactNative.types";
import KrdpassAuthReactNativeModule from "../NativeKrdpassAuthReactNative";
import {
  authenticate,
  cancelPendingAuthentication,
  decodeTokenUnverified,
  generatePkcePair,
  generateState,
  getUserInfo,
  initialize,
  isAuthResultBusy,
  isAuthResultCancelled,
  isAuthResultError,
  isAuthResultSuccess,
  isAuthResultTimeout,
  KrdpassAuthError,
  KrdpassScopes,
  makeTokenResult,
  refreshTokens,
  revokeToken,
  signIn,
  verifyToken,
} from "../index";
// messageForErrorCode and KrdpassMessages are internal, so they import from their module
// rather than the package root. ts-jest hoists these jest.mock calls above the imports.
jest.mock("react-native", () => ({
  Linking: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: { OS: "ios" },
}));
// The native module self-loads on import (and throws off-device), so mock it.
jest.mock("../NativeKrdpassAuthReactNative", () => ({
  __esModule: true,
  default: {
    signIn: jest.fn(),
    authenticate: jest.fn(),
    getUserInfo: jest.fn(),
    refreshTokens: jest.fn(),
    revokeToken: jest.fn(),
    verifyToken: jest.fn(),
    generatePkcePair: jest.fn(),
    handleURL: jest.fn(),
    cancelAuthentication: jest.fn(),
  },
}));
// Stubbed to a no-op: on Node, globalThis.crypto already has a CSPRNG.
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

  it("rejects a payload containing non-base64 characters", () => {
    // A decoder that skips characters outside the alphabet decodes a mangled token cleanly,
    // so this asserts real rejection of a valid encoding with '!' injected between characters.
    const valid = encodeSegment({ sub: "abc" });
    const mangled = valid.split("").join("!");
    expect(() => decodeTokenUnverified(`header.${mangled}.sig`)).toThrow();
    // Sanity check that the un-mangled fixture really is decodable.
    expect(decodeTokenUnverified(`header.${valid}.sig`).sub).toBe("abc");
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
      ISSUER_MISMATCH:
        "Issuer mismatch: the response did not come from the expected authorization server",
      PROVIDER_NOT_INSTALLED:
        "The KRDPASS app is not installed or could not be opened. Please install or update KRDPASS.",
      NO_CODE: "No authorization code received",
      INVALID_REDIRECT:
        "Redirect URI does not match the exact configured endpoint",
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
    // An RFC 9207 mix-up attack must never read as a cancel or as CSRF.
    expect(messageForErrorCode("issuer_mismatch")).toBe(
      KrdpassMessages.ISSUER_MISMATCH,
    );
    expect(messageForErrorCode("issuer_mismatch")).not.toBe(
      KrdpassMessages.STATE_MISMATCH,
    );
    // Token replay keeps its own message, and must never read as a cancel.
    expect(messageForErrorCode("nonce_mismatch")).toBe(
      KrdpassMessages.NONCE_MISMATCH,
    );
    expect(messageForErrorCode("nonce_mismatch")).not.toBe(
      KrdpassMessages.CANCELLED,
    );
    expect(messageForErrorCode("some_server_code")).toBeUndefined();
  });

  // The cores emit invalid_id_token with dynamic text; a canonical string here would throw
  // away the only diagnostic. Undefined is correct: the caller keeps the native text.
  it("leaves invalid_id_token unmapped so its variable message survives", () => {
    expect(messageForErrorCode("invalid_id_token")).toBeUndefined();
    expect(messageForErrorCode("invalid_id_token")).not.toBe(
      KrdpassMessages.MISSING_ID_TOKEN,
    );
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

  it("rejects a redirectUri carrying a fragment (RFC 6749 section 3.1.2)", () => {
    expect(() =>
      initialize({
        clientId: "c",
        redirectUri: "https://app.example.com/cb#frag",
      }),
    ).toThrow(/HTTPS/i);
  });

  it("rejects a userinfo authority masquerading as the host", () => {
    expect(() =>
      initialize({
        clientId: "c",
        redirectUri: "https://evil.example.com@app.example.com/cb",
      }),
    ).toThrow(/HTTPS/i);
  });

  // The two rows a WHATWG `new URL()` check answers differently on device, where React Native
  // polyfills global URL with a non-validating class.
  it("accepts an uppercase scheme", () => {
    expect(() =>
      initialize({ clientId: "c", redirectUri: "HTTPS://app.example.com/cb" }),
    ).not.toThrow();
  });

  it("rejects a scheme-relative form with no //", () => {
    // WHATWG parsing normalizes this into https://app.example.com/cb; the regex demands the
    // literal "https://" the natives compare against.
    expect(() =>
      initialize({ clientId: "c", redirectUri: "https:app.example.com/cb" }),
    ).toThrow(/HTTPS/i);
  });
});

describe("signIn config fallback (parity with iOS/Android/Flutter)", () => {
  it("omits scopes entirely when the array is empty, so the natives apply their defaults", async () => {
    const nativeSignIn = KrdpassAuthReactNativeModule.signIn as jest.Mock;
    nativeSignIn.mockResolvedValue({
      accessToken: "at",
      tokenType: "Bearer",
      expiresIn: 3600,
    });
    initialize({ clientId: "c", redirectUri: "https://app.example.com/cb" });

    await signIn({ scopes: [] });

    expect(nativeSignIn).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ scopes: expect.anything() }),
    );
  });

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

  // Both native modules reject the promise on failure with an Error carrying .code.
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
    expect((err as KrdpassAuthError).errorDescription).toBe(
      KrdpassMessages.CANCELLED,
    );
    expect((err as KrdpassAuthError).rawDescription).toBe(
      "User cancelled authentication",
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
    const result = await authenticate({
      requestUri: "urn:abc",
      state: "st",
      timeout: 0,
    });
    expect(result).toMatchObject({ error: "platform_error" });
    expect(nativeAuth()).not.toHaveBeenCalled();
  });

  it.each(["", "   ", undefined])(
    "returns platform_error for a blank requestUri (%p) WITHOUT calling native",
    async (requestUri) => {
      const result = await authenticate({
        requestUri: requestUri as string,
        state: "st",
      });
      expect(result).toEqual({
        error: "platform_error",
        errorDescription: "requestUri is required",
      });
      expect(nativeAuth()).not.toHaveBeenCalled();
    },
  );

  it("passes exactly the fields the natives read, nothing smuggled in", async () => {
    nativeAuth().mockResolvedValue({ code: "auth-code" });
    await authenticate({ requestUri: "urn:abc", state: "st", timeout: 30 });
    expect(nativeAuth()).toHaveBeenLastCalledWith({
      clientId: "c",
      requestUri: "urn:abc",
      redirectUri: "https://app.example.com/cb",
      environment: "production",
      state: "st",
      timeout: 30,
    });
  });

  it("rejects a whitespace-only state WITHOUT calling native", async () => {
    // The two cores disagree on blank-vs-empty state, so the JS layer decides it for both.
    const result = await authenticate({ requestUri: "urn:abc", state: "   " });
    expect(result).toEqual({
      error: "invalid_request",
      errorDescription: KrdpassMessages.STATE_REQUIRED,
    });
    expect(nativeAuth()).not.toHaveBeenCalled();
  });

  it("rejects an omitted state WITHOUT calling native", async () => {
    // The type requires state, but an untyped caller can still omit it.
    const config = { requestUri: "urn:abc" } as AuthenticateConfig;
    const result = await authenticate(config);
    expect(result).toEqual({
      error: "invalid_request",
      errorDescription: KrdpassMessages.STATE_REQUIRED,
    });
    expect(nativeAuth()).not.toHaveBeenCalled();
  });

  it("surfaces the canonical message for a known wire code, keeping the original", async () => {
    nativeAuth().mockResolvedValue({
      error: "state_mismatch",
      error_description: "State did not match",
    });
    const result = await authenticate({ requestUri: "urn:abc", state: "st" });
    expect(result).toEqual({
      error: "state_mismatch",
      errorDescription: KrdpassMessages.STATE_MISMATCH,
      rawDescription: "State did not match",
    });
  });

  it("surfaces issuer_mismatch with its own message, keeping the raw text", async () => {
    nativeAuth().mockResolvedValue({
      error: "issuer_mismatch",
      error_description: "iss was https://evil.example",
    });
    const result = await authenticate({ requestUri: "urn:abc", state: "st" });
    expect(result).toEqual({
      error: "issuer_mismatch",
      errorDescription: KrdpassMessages.ISSUER_MISMATCH,
      rawDescription: "iss was https://evil.example",
    });
  });

  it("surfaces nonce_mismatch with its own message, keeping the raw text", async () => {
    nativeAuth().mockResolvedValue({
      error: "nonce_mismatch",
      error_description: "nonce was abc123",
    });
    const result = await authenticate({ requestUri: "urn:abc", state: "st" });
    expect(result).toEqual({
      error: "nonce_mismatch",
      errorDescription: KrdpassMessages.NONCE_MISMATCH,
      rawDescription: "nonce was abc123",
    });
  });

  it("keeps the dynamic invalid_id_token reason instead of a canonical one", async () => {
    nativeAuth().mockResolvedValue({
      error: "invalid_id_token",
      error_description: "ID token validation failed: signature mismatch",
    });
    const result = await authenticate({ requestUri: "urn:abc", state: "st" });
    expect(result).toEqual({
      error: "invalid_id_token",
      errorDescription: "ID token validation failed: signature mismatch",
      rawDescription: "ID token validation failed: signature mismatch",
    });
  });

  it("preserves a server reason the canonical cancelled message would destroy", async () => {
    // Without rawDescription the real reason is unrecoverable. `cancelled`, not
    // `access_denied`: both cores rewrite the OAuth aliases before returning.
    nativeAuth().mockResolvedValue({
      error: "cancelled",
      error_description: "User is not eligible for citizen_identity",
    });
    const result = await authenticate({ requestUri: "urn:abc", state: "st" });
    expect(result).toEqual({
      error: "cancelled",
      errorDescription: KrdpassMessages.CANCELLED,
      rawDescription: "User is not eligible for citizen_identity",
    });
  });

  it("uses the canonical message when a cancellation carries no description", async () => {
    nativeAuth().mockResolvedValue({ error: "cancelled" });
    const result = await authenticate({ requestUri: "urn:abc", state: "st" });
    expect(result).toEqual({
      error: "cancelled",
      errorDescription: KrdpassMessages.CANCELLED,
    });
  });

  it("falls back to the native description for an unknown code", async () => {
    nativeAuth().mockResolvedValue({
      error: "some_server_code",
      error_description: "Server says no",
    });
    const result = await authenticate({ requestUri: "urn:abc", state: "st" });
    expect(result).toEqual({
      error: "some_server_code",
      errorDescription: "Server says no",
      rawDescription: "Server says no",
    });
  });

  it("passes a success result through unchanged", async () => {
    nativeAuth().mockResolvedValue({ code: "auth-code", state: "xyz" });
    const result = await authenticate({ requestUri: "urn:abc", state: "st" });
    expect(isAuthResultSuccess(result)).toBe(true);
    expect(result).toEqual({ code: "auth-code", state: "xyz" });
  });

  it("fails closed with no_code when a success carries no code", async () => {
    nativeAuth().mockResolvedValue({ state: "xyz" });
    const result = await authenticate({ requestUri: "urn:abc", state: "st" });
    expect(result).toEqual({
      error: "no_code",
      errorDescription: KrdpassMessages.NO_CODE,
    });
  });

  it("turns a native rejection into an AuthResult instead of throwing", async () => {
    nativeAuth().mockRejectedValue(
      Object.assign(new Error("Connection reset"), { code: "network_error" }),
    );
    const result = await authenticate({ requestUri: "urn:abc", state: "st" });
    expect(result).toEqual({
      error: "network_error",
      errorDescription: "Connection reset",
      rawDescription: "Connection reset",
    });
  });

  it("falls back to platform_error for a codeless native rejection", async () => {
    nativeAuth().mockRejectedValue(new Error("boom"));
    const result = await authenticate({ requestUri: "urn:abc", state: "st" });
    expect(result).toMatchObject({
      error: "platform_error",
      rawDescription: "boom",
    });
  });
});

describe("authenticate before initialize()", () => {
  it("returns platform_error instead of throwing", async () => {
    // The stored config is module state and every other describe calls initialize(), so this
    // one needs its own module registry.
    let fresh: typeof import("../index") | undefined;
    jest.isolateModules(() => {
      fresh = require("../index") as typeof import("../index");
    });
    const result = await fresh!.authenticate({ requestUri: "urn:abc", state: "st" });
    expect(result).toMatchObject({ error: "platform_error" });
    expect((result as { errorDescription?: string }).errorDescription).toMatch(
      /initialize/i,
    );
  });
});

describe("cancelPendingAuthentication", () => {
  const nativeCancel = () =>
    KrdpassAuthReactNativeModule.cancelAuthentication as jest.Mock;

  it("returns what the native module reports, without needing initialize()", async () => {
    nativeCancel().mockResolvedValue(true);
    await expect(cancelPendingAuthentication()).resolves.toBe(true);
    expect(nativeCancel()).toHaveBeenLastCalledWith({ timeout: false });

    nativeCancel().mockResolvedValue(false);
    await expect(cancelPendingAuthentication({ timeout: true })).resolves.toBe(
      false,
    );
    expect(nativeCancel()).toHaveBeenLastCalledWith({ timeout: true });
  });

  it("normalizes a native rejection like every other rejecting method", async () => {
    nativeCancel().mockRejectedValue(new Error("no bridge"));
    const err = await cancelPendingAuthentication().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(KrdpassAuthError);
    expect((err as KrdpassAuthError).code).toBe("platform_error");
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
      given_name: "Jane",
      family_name: "Doe",
      citizen_first: "Jane",
      citizen_surname: "Doe",
      sex_at_birth: "male",
      custom_claim: "x",
    });
    const info = await getUserInfo({ accessToken: "at" });
    expect(info.sub).toBe("user-1");
    expect(info.givenName).toBe("Jane");
    expect(info.familyName).toBe("Doe");
    expect(info.sexAtBirth).toBe("male");
    expect(info.citizenFullName).toBe("Jane Doe");
    expect(info.raw.custom_claim).toBe("x");
  });

  it("trims each citizenFullName part and drops the blank ones", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({
      sub: "user-1",
      citizen_first: " Ali ",
      citizen_second: "  Aram  ",
      citizen_third: "   ",
      citizen_surname: " Karim",
    });
    const info = await getUserInfo({ accessToken: "at" });
    expect(info.citizenFullName).toBe("Ali Aram Karim");
    expect(info.citizenFullName).not.toContain("  ");
    // The individual claims keep whatever the server sent; only the joined string is normalised.
    expect(info.citizenFirst).toBe(" Ali ");
  });

  it("leaves citizenFullName undefined when every part is blank", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({
      sub: "user-1",
      citizen_first: " ",
      citizen_surname: "",
    });
    const info = await getUserInfo({ accessToken: "at" });
    expect(info.citizenFullName).toBeUndefined();
  });

  // CAS sends "" for a claim it has no value for; Android reads those as absent, so an app
  // branching on `upn` must see the same thing here.
  it("reads an empty string claim as undefined", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({
      sub: "user-1",
      upn: "",
      email: "",
      given_name: "",
    });
    const info = await getUserInfo({ accessToken: "at" });
    expect(info.upn).toBeUndefined();
    expect(info.email).toBeUndefined();
    expect(info.givenName).toBeUndefined();
  });

  it("reads a whitespace-only claim as undefined", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({
      sub: "user-1",
      upn: "   ",
      birthdate: "\t\n",
      sex_at_birth: " ",
    });
    const info = await getUserInfo({ accessToken: "at" });
    expect(info.upn).toBeUndefined();
    expect(info.birthdate).toBeUndefined();
    expect(info.sexAtBirth).toBeUndefined();
  });

  it("keeps a padded claim untrimmed, the filter only drops blanks", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({ sub: "user-1", upn: " 1990123456 " });
    const info = await getUserInfo({ accessToken: "at" });
    expect(info.upn).toBe(" 1990123456 ");
  });

  it("falls back to the citizen picture when picture is blank", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({
      sub: "user-1",
      picture: "  ",
      citizen_profile_picture: "https://cdn.example.com/a.png",
    });
    const info = await getUserInfo({ accessToken: "at" });
    expect(info.picture).toBe("https://cdn.example.com/a.png");
  });

  // sub keeps its own rule: empty fails the parse, blank does not, matching the other SDKs.
  it("accepts a whitespace-only sub", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({ sub: " " });
    const info = await getUserInfo({ accessToken: "at" });
    expect(info.sub).toBe(" ");
  });

  it("throws when the response has no sub", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({ name: "no sub" });
    await expect(getUserInfo({ accessToken: "at" })).rejects.toThrow(/sub/i);
  });

  it("maps upns when present as an array of strings", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({
      sub: "user-1",
      upn: "current@krd",
      upns: ["old1@krd", "old2@krd"],
    });
    const info = await getUserInfo({ accessToken: "at" });
    expect(info.upns).toEqual(["old1@krd", "old2@krd"]);
  });

  // Blank entries inside upns survive, matching Android; the list is stored, never displayed.
  it("keeps blank entries inside upns", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({ sub: "user-1", upns: ["old1@krd", "", "  "] });
    const info = await getUserInfo({ accessToken: "at" });
    expect(info.upns).toEqual(["old1@krd", "", "  "]);
  });

  it("defaults upns to an empty array when absent", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({ sub: "user-1" });
    const info = await getUserInfo({ accessToken: "at" });
    expect(info.upns).toEqual([]);
  });

  it("falls back to an empty array when upns is present but not an array of strings", async () => {
    const native = KrdpassAuthReactNativeModule.getUserInfo as jest.Mock;
    native.mockResolvedValue({ sub: "user-1", upns: "not-an-array" });
    const info = await getUserInfo({ accessToken: "at" });
    expect(info.upns).toEqual([]);
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
    expect(tokens.isExpired(3600 + 60)).toBe(true);
  });
});

describe("token-op error normalization (lowercase cross-SDK codes)", () => {
  const cases: {
    name: string;
    call: () => Promise<unknown>;
    native: () => jest.Mock;
    fallbackCode: string;
  }[] = [
    {
      name: "getUserInfo",
      call: () => getUserInfo({ accessToken: "at" }),
      native: () => KrdpassAuthReactNativeModule.getUserInfo as jest.Mock,
      fallbackCode: "user_info_failed",
    },
    {
      name: "refreshTokens",
      call: () => refreshTokens({ refreshToken: "rt" }),
      native: () => KrdpassAuthReactNativeModule.refreshTokens as jest.Mock,
      fallbackCode: "refresh_failed",
    },
    {
      name: "revokeToken",
      call: () => revokeToken({ token: "t" }),
      native: () => KrdpassAuthReactNativeModule.revokeToken as jest.Mock,
      fallbackCode: "revoke_failed",
    },
    {
      name: "verifyToken",
      call: () => verifyToken({ idToken: "idt" }),
      native: () => KrdpassAuthReactNativeModule.verifyToken as jest.Mock,
      fallbackCode: "verification_failed",
    },
    {
      name: "generatePkcePair",
      call: () => generatePkcePair(),
      native: () => KrdpassAuthReactNativeModule.generatePkcePair as jest.Mock,
      fallbackCode: "pkce_generation_failed",
    },
  ];

  beforeEach(() => {
    initialize({ clientId: "c", redirectUri: "https://app.example.com/cb" });
  });

  it.each(cases)(
    "$name wraps a codeless rejection as $fallbackCode",
    async ({ call, native, fallbackCode }) => {
      native().mockRejectedValue(new Error("CAS said 400: invalid_grant"));
      const err = await call().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(KrdpassAuthError);
      expect((err as KrdpassAuthError).code).toBe(fallbackCode);
      // On the token path the server text is the only diagnostic there is.
      expect((err as KrdpassAuthError).errorDescription).toBe(
        "CAS said 400: invalid_grant",
      );
      expect((err as KrdpassAuthError).rawDescription).toBe(
        "CAS said 400: invalid_grant",
      );
    },
  );

  it.each(cases)(
    "$name forwards a structured code from the bridge instead of $fallbackCode",
    async ({ call, native }) => {
      native().mockRejectedValue(
        Object.assign(new Error("Connection reset"), { code: "network_error" }),
      );
      const err = await call().then(
        () => null,
        (e: unknown) => e,
      );
      expect((err as KrdpassAuthError).code).toBe("network_error");
      expect((err as KrdpassAuthError).rawDescription).toBe("Connection reset");
    },
  );

  it("leaves a local argument error as a plain Error, not a wire code", async () => {
    // Caller bugs are not wire failures.
    await expect(getUserInfo({ accessToken: " " })).rejects.not.toBeInstanceOf(
      KrdpassAuthError,
    );
  });
});

describe("null coercion at the bridge boundary", () => {
  // Both bridges emit JSON null for an absent optional while the published .d.ts declares
  // `?: string`. Without coercion the type is a runtime lie.
  it("makeTokenResult turns null idToken/refreshToken/scope into undefined", () => {
    const tokens = makeTokenResult({
      accessToken: "at",
      expiresIn: 3600,
      tokenType: "Bearer",
      idToken: null,
      refreshToken: null,
      scope: null,
    } as unknown as Parameters<typeof makeTokenResult>[0]);
    expect(tokens.idToken).toBeUndefined();
    expect(tokens.refreshToken).toBeUndefined();
    expect(tokens.scope).toBeUndefined();
  });

  it("authenticate turns a null state into undefined", async () => {
    initialize({ clientId: "c", redirectUri: "https://app.example.com/cb" });
    const nativeAuth = KrdpassAuthReactNativeModule.authenticate as jest.Mock;
    nativeAuth.mockResolvedValue({ code: "auth-code", state: null });
    const result = await authenticate({ requestUri: "urn:abc", state: "st" });
    expect(isAuthResultSuccess(result)).toBe(true);
    expect((result as { state?: string }).state).toBeUndefined();
  });
});

describe("isExpired is detachable and fails closed", () => {
  const base = { accessToken: "at", tokenType: "Bearer" };

  it("works when the method is detached from the result", () => {
    // Reading `this.expiresIn` instead of the closure would make a detached isExpired throw.
    const { isExpired } = makeTokenResult({ ...base, expiresIn: 3600 });
    expect(isExpired()).toBe(false);
    expect(isExpired(3600 + 60)).toBe(true);
    expect([makeTokenResult({ ...base, expiresIn: 3600 })].some((t) => t.isExpired())).toBe(
      false,
    );
  });

  it("honors a supplied receivedAt instead of resetting the expiry clock", () => {
    // Re-wrapping a token stored two hours ago: with a fresh Date.now() stamp this token
    // would wrongly read as unexpired.
    const receivedAt = Date.now() - 7_200_000;
    const tokens = makeTokenResult({ ...base, expiresIn: 3600, receivedAt });
    expect(tokens.receivedAt).toBe(receivedAt);
    expect(tokens.isExpired()).toBe(true);
  });

  it.each([undefined, NaN, Infinity, "3600"])(
    "reports expired when expiresIn is not a finite number: %p",
    (expiresIn) => {
      // A backend sending snake_case `expires_in` leaves expiresIn undefined and the token
      // fresh forever. A freshness check must fail closed.
      const tokens = makeTokenResult({
        ...base,
        expiresIn,
      } as unknown as Parameters<typeof makeTokenResult>[0]);
      expect(tokens.isExpired()).toBe(true);
    },
  );
});

describe("initialize environment validation", () => {
  // A bad value usually arrives from an env var through a cast and must fail here, not natively.
  it.each(["production", "development", undefined])(
    "accepts the documented value %p",
    (environment) => {
      expect(() =>
        initialize({
          clientId: "c",
          redirectUri: "https://app.example.com/cb",
          environment: environment as "production" | "development" | undefined,
        }),
      ).not.toThrow();
    },
  );

  it.each(["PRODUCTION", "prod", "staging", "", "  ", "Development"])(
    "throws at initialize for %p",
    (environment) => {
      expect(() =>
        initialize({
          clientId: "c",
          redirectUri: "https://app.example.com/cb",
          environment: environment as "production" | "development",
        }),
      ).toThrow(/environment must be/i);
    },
  );
});

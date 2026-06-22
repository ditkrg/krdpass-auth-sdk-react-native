import KrdpassAuthReactNativeModule from "../KrdpassAuthReactNativeModule";
import {
  buildAuthorizationUrl,
  decodeTokenUnverified,
  generateState,
  initialize,
  isAuthResultBusy,
  isAuthResultCancelled,
  isAuthResultError,
  isAuthResultSuccess,
  isAuthResultTimeout,
  signIn,
} from "../index";

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
  default: { signIn: jest.fn() },
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
    const token = `header.${encodeSegment({ sub: "123", scope: "openid" })}.sig`;
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

describe("buildAuthorizationUrl", () => {
  const base = {
    requestUri: "urn:ietf:params:oauth:request_uri:abc",
    clientId: "my-client",
    redirectUri: "https://app.example.com/cb",
  };

  it("builds a production authorize URL with the required params", () => {
    const url = buildAuthorizationUrl({ ...base, environment: "production" });
    expect(url).toContain("https://app.pass.krd/connect/authorize");
    expect(url).toContain("client_id=my-client");
    expect(url).toContain(encodeURIComponent(base.requestUri));
    expect(url).toContain(encodeURIComponent(base.redirectUri));
  });

  it("uses the development host and includes state", () => {
    const url = buildAuthorizationUrl({
      ...base,
      environment: "development",
      state: "xyz",
    });
    expect(url).toContain("https://app.krdpass.dev.krd/connect/authorize");
    expect(url).toContain("state=xyz");
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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (relativePath: string): string =>
  readFileSync(resolve(__dirname, "../..", relativePath), "utf8");

const ANDROID = source(
  "android/src/main/java/krdpass/auth/reactnative/KrdpassAuthReactNativeModule.kt",
);
const IOS = source("ios/KrdpassAuthReactNativeModule.swift");
const TYPES = source("src/KrdpassAuthReactNative.types.ts");

/**
 * The members of the AuthErrorCode union, read off its declaration.
 *
 * Read from source rather than restated here on purpose: a hand-kept copy is a second source
 * of truth that drifts. The union is applied to `AuthResultError.error` and
 * `KrdpassAuthError.code`, so what this list really describes is what a caller can branch on
 * with type support.
 */
const unionMembers = (): string[] => {
  const start = TYPES.indexOf("export type AuthErrorCode =");
  expect(start).toBeGreaterThan(-1);
  // Bounded by the blank line after the declaration, not by the first `;`: the union carries
  // prose comments between its members and one of them contains a semicolon.
  const declaration = TYPES.slice(start, TYPES.indexOf("\n\n", start));
  // Proves the whole declaration was captured, so a truncated slice cannot quietly shrink
  // the list this file compares everything against.
  expect(declaration.trimEnd().endsWith('";')).toBe(true);
  return [...declaration.matchAll(/^\s*\|\s*"([a-z_]+)"/gm)].map((m) => m[1]);
};

/** Every string literal a bridge passes as a promise rejection code. */
const rejectCodes = (bridge: string): string[] =>
  [...bridge.matchAll(/reject\(\s*"([^"]+)"/g)].map((m) => m[1]);

/** Every string literal a bridge resolves as an AuthResult `error` (the authenticate path). */
const resolvedErrorCodes = (bridge: string, isKotlin: boolean): string[] =>
  [
    ...bridge.matchAll(
      isKotlin ? /resolveAuthError\([^,]+,\s*"([^"]+)"/g : /"error": "([^"]+)"/g,
    ),
  ].map((m) => m[1]);

/**
 * Codes a bridge emits through a classifier helper rather than a literal at the reject site, i.e.
 * the `?: "code"` / `?? "code"` fallbacks in verifyErrorCode and krdpassErrorCode. Without these
 * the extraction would miss verification_failed and report the contract as shrinking when the
 * bridge merely stopped hardcoding it.
 */
const fallbackCodes = (bridge: string): string[] =>
  [...bridge.matchAll(/\?[?:]\s*"([a-z_]+)"/g)].map((m) => m[1]);

describe("AuthErrorCode union", () => {
  it("declares the cross-SDK per-call failure codes", () => {
    expect(unionMembers()).toEqual(
      expect.arrayContaining([
        "user_info_failed",
        "refresh_failed",
        "revoke_failed",
        "verification_failed",
        "pkce_generation_failed",
        "authentication_failed",
        "invalid_request",
        "network_error",
        "platform_error",
        "launch_failed",
      ]),
    );
  });

  it("is applied to both fields it documents, not to nothing", () => {
    // The union used to be annotated on nothing at all, so its own claim of giving callers
    // autocomplete and exhaustiveness checking was false. `string & {}` is what keeps a
    // forwarded server code assignable without collapsing the union back to `string`.
    expect(TYPES).toContain("error: AuthErrorCode | (string & {});");
    expect(TYPES).toContain("readonly code: AuthErrorCode | (string & {});");
  });
});

describe.each([
  ["android", ANDROID, true],
  ["ios", IOS, false],
] as const)("%s bridge wire codes", (_platform, bridge, isKotlin) => {
  const codes = [
    ...rejectCodes(bridge),
    ...resolvedErrorCodes(bridge, isKotlin),
    ...fallbackCodes(bridge),
  ];

  it("emits at least one code (the extraction regexes still match)", () => {
    // Guards against a refactor making the regexes match nothing, which would leave every
    // assertion below vacuously true.
    expect(codes.length).toBeGreaterThan(10);
  });

  // The token ops used to reject with UPPERCASE codes forked from the lowercase family the
  // Android, iOS and Flutter SDKs share (USER_INFO_ERROR, REFRESH_ERROR, PKCE_ERROR, ...).
  // They now use the shared codes, and this is what keeps them there.
  it("uses no UPPERCASE (forked) code", () => {
    expect(codes.filter((code) => /[A-Z]/.test(code))).toEqual([]);
  });

  it("emits only codes the AuthErrorCode union declares", () => {
    const declared = unionMembers();
    expect(codes.filter((code) => !declared.includes(code))).toEqual([]);
  });

  // verifyToken used to reject with a hardcoded "verification_failed", which flattened the
  // core's own classification: a JWKS transport failure (network_error, worth retrying) became
  // indistinguishable from a bad signature (invalid_id_token, permanent). The bridge now asks a
  // helper, so the core's code is forwarded and verification_failed is only the fallback.
  it("forwards the core's verifyToken code instead of hardcoding one", () => {
    const forwarder = isKotlin
      ? "promise.reject(verifyErrorCode(e)"
      : "reject(Self.verifyErrorCode(error)";
    expect(bridge).toContain(forwarder);
    expect(bridge).toContain("verifyErrorCode");
    // The old flattening shape must not come back.
    const flattened = isKotlin
      ? 'promise.reject("verification_failed"'
      : 'reject("verification_failed"';
    expect(bridge).not.toContain(flattened);
  });

  it.each([
    "user_info_failed",
    "refresh_failed",
    "revoke_failed",
    "verification_failed",
    "pkce_generation_failed",
    "invalid_request",
  ])("still emits the cross-SDK code %s", (code) => {
    expect(codes).toContain(code);
  });
});

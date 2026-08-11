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
 * The members of the AuthErrorCode union, read off its declaration rather than
 * restated here, since a hand-kept copy drifts.
 */
const unionMembers = (): string[] => {
  const start = TYPES.indexOf("export type AuthErrorCode =");
  expect(start).toBeGreaterThan(-1);
  // Bounded by the blank line after the declaration, so inline comments between members
  // cannot truncate the slice.
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
 * Codes a bridge emits through its settling helper rather than a literal at the reject site:
 * the classifier fallbacks and the per-call fallback argument taken by launchSettling on
 * Android and perform on iOS.
 */
const fallbackCodes = (bridge: string): string[] =>
  [
    ...bridge.matchAll(/\?[?:]\s*"([a-z_]+)"/g),
    ...bridge.matchAll(/launchSettling\(promise,\s*"([a-z_]+)"/g),
    ...bridge.matchAll(/fallback:\s*"([a-z_]+)"/g),
  ].map((m) => m[1]);

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
    // `string & {}` keeps a forwarded server code assignable without collapsing the union.
    expect(TYPES).toContain("error: AuthErrorCode | (string & {});");
    expect(TYPES).toContain("readonly code: AuthErrorCode | (string & {});");
  });
});

describe("ios facade header", () => {
  const HEADER = source("ios/KrdpassAuthReactNativeModule.h");

  // The header's selectors are hand-copied from the Swift module, and a renamed selector on
  // one side compiles and then fails at runtime as an unrecognized selector. This is the check.
  it("declares exactly the selectors the Swift module exposes", () => {
    const swiftSelectors = [...IOS.matchAll(/@objc\(([\w:]+)\)/g)]
      .map((m) => m[1])
      // The class-name attribute has no colon; drop it.
      .filter((selector) => selector.includes(":"));
    // `teardown` is exposed with a bare @objc, so its selector is implicit.
    swiftSelectors.push("teardown");

    const headerSelectors = [...HEADER.matchAll(/^- \(void\)([\s\S]*?);/gm)].map(
      (m) =>
        [...m[1].matchAll(/(\w+):/g)].map((part) => `${part[1]}:`).join("") ||
        m[1].trim(),
    );

    expect([...headerSelectors].sort()).toEqual([...swiftSelectors].sort());
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

  // An UPPERCASE code (USER_INFO_ERROR, PKCE_ERROR, ...) is a fork of the lowercase family the
  // Android, iOS and Flutter SDKs share, which callers branch on.
  it("uses no UPPERCASE (forked) code", () => {
    expect(codes.filter((code) => /[A-Z]/.test(code))).toEqual([]);
  });

  it("emits only codes the AuthErrorCode union declares", () => {
    const declared = unionMembers();
    expect(codes.filter((code) => !declared.includes(code))).toEqual([]);
  });

  // Hardcoding "verification_failed" flattens the core's classification: a retryable JWKS
  // transport failure becomes indistinguishable from a permanent bad signature.
  it("forwards the core's verifyToken code instead of hardcoding one", () => {
    const forwarder = isKotlin
      ? 'launchSettling(promise, "verification_failed")'
      : 'fallback: "verification_failed"';
    expect(bridge).toContain(forwarder);
    // The flattening shape must not come back.
    const flattened = isKotlin
      ? 'promise.reject("verification_failed"'
      : 'reject("verification_failed"';
    expect(bridge).not.toContain(flattened);
  });

  // One classification site per bridge, shared by all four token calls: the core's own code
  // wins, the per-call fallback only fills in when it has none.
  it("classifies token failures in one place", () => {
    expect(bridge).toContain(
      isKotlin
        ? "sdkErrorCode(e) ?: fallbackCode"
        : "Self.sdkErrorCode(error) ?? fallback",
    );
  });

  // Rejecting with the per-call permanent code unconditionally would report a transient
  // network_error or timeout as a non-retryable failure, and apps log users out on a flaky
  // connection.
  it.each(["user_info_failed", "refresh_failed", "revoke_failed"])(
    "uses %s as the codeless fallback, not a hardcoded rejection",
    (code) => {
      const hardcoded = isKotlin
        ? `promise.reject("${code}"`
        : `reject("${code}"`;
      expect(bridge).not.toContain(hardcoded);
      const fallback = isKotlin
        ? `launchSettling(promise, "${code}")`
        : `fallback: "${code}"`;
      expect(bridge).toContain(fallback);
    },
  );

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

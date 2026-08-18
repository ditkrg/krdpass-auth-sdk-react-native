import type { Spec } from "../NativeKrdpassAuthReactNative";

describe("NativeKrdpassAuthReactNative", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("loads the Codegen module using its stable runtime name", () => {
    const nativeModule: Pick<
      Spec,
      | "signIn"
      | "authenticate"
      | "cancelAuthentication"
      | "getUserInfo"
      | "refreshTokens"
      | "revokeToken"
      | "verifyToken"
      | "generatePkcePair"
      | "handleURL"
    > = {
      signIn: jest.fn(),
      authenticate: jest.fn(),
      cancelAuthentication: jest.fn(),
      getUserInfo: jest.fn(),
      refreshTokens: jest.fn(),
      revokeToken: jest.fn(),
      verifyToken: jest.fn(),
      generatePkcePair: jest.fn(),
      handleURL: jest.fn(),
    };
    const getEnforcing = jest.fn(() => nativeModule);

    jest.doMock("react-native", () => ({
      TurboModuleRegistry: { getEnforcing },
    }));

    let loaded: unknown;
    jest.isolateModules(() => {
      loaded = require("../NativeKrdpassAuthReactNative").default;
    });

    expect(getEnforcing).toHaveBeenCalledTimes(1);
    expect(getEnforcing).toHaveBeenCalledWith("KrdpassAuthReactNative");
    expect(loaded).toBe(nativeModule);
    // No assertion on the method list: the `Pick<Spec, ...>` annotation on the literal above
    // guards the surface, so dropping or renaming a method fails the TypeScript build.
  });
});

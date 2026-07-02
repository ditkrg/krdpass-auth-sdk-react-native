import { NativeModules } from "react-native";

type KrdpassNativeModule = {
  signIn: (config: unknown) => Promise<unknown>;
  authenticate: (config: unknown) => Promise<unknown>;
  cancelAuthentication?: (config?: { timeout?: boolean }) => Promise<unknown>;
  getUserInfo: (config: unknown) => Promise<unknown>;
  refreshTokens: (config: unknown) => Promise<unknown>;
  revokeToken: (config: unknown) => Promise<unknown>;
  verifyToken: (config: unknown) => Promise<unknown>;
  generatePkcePair: () => Promise<{
    codeVerifier: string;
    codeChallenge: string;
  }>;
  // Fire-and-forget on the native side; callers must not rely on a return value.
  handleURL?: (url: string) => void;
};

function loadNativeModule(): KrdpassNativeModule {
  const rnNativeModule = NativeModules.KrdpassAuthReactNative as
    | KrdpassNativeModule
    | undefined;
  if (rnNativeModule) return rnNativeModule;

  try {
    // Works in Expo apps and bare React Native apps configured with Expo Modules runtime.

    const expoModulesCore = require("expo-modules-core") as {
      requireNativeModule: <T>(moduleName: string) => T;
    };
    return expoModulesCore.requireNativeModule<KrdpassNativeModule>(
      "KrdpassAuthReactNative",
    );
  } catch {
    throw new Error(
      [
        "KrdpassAuthReactNative native module is not available.",
        "Expo apps: run `npx expo prebuild` after installing this package.",
        "Bare React Native apps: run `npx install-expo-modules@latest` once, then rebuild the native app.",
      ].join(" "),
    );
  }
}

export default loadNativeModule();

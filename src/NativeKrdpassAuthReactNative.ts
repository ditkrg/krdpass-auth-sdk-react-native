import type { TurboModule } from "react-native";
import type { UnsafeObject } from "react-native/Libraries/Types/CodegenTypes";
import { TurboModuleRegistry } from "react-native";

/**
 * The native bridge contract consumed by React Native Codegen.
 *
 * `UnsafeObject` is the permanent shape of this surface. `getUserInfo` and
 * `verifyToken` return open-ended claim maps whose keys the provider picks at
 * runtime, which Codegen has no way to express, and routing `authenticate`
 * through a Codegen struct would flatten its discriminated union into a single
 * all-optional record, strictly worse than the TypeScript union already exported
 * from `index.ts`. Those maps are also shared verbatim with the Android, iOS and
 * Flutter SDKs, so restating them here would fork one wire contract into a fifth
 * hand-maintained definition. `UnsafeObject` keeps the NSDictionary/ReadableMap
 * ABI those SDKs already agree on; the richer public types live in `index.ts`,
 * which is where the typing belongs.
 */
export interface Spec extends TurboModule {
  signIn(config: UnsafeObject): Promise<UnsafeObject>;
  authenticate(config: UnsafeObject): Promise<UnsafeObject>;
  cancelAuthentication(config: UnsafeObject): Promise<boolean>;
  getUserInfo(config: UnsafeObject): Promise<UnsafeObject>;
  refreshTokens(config: UnsafeObject): Promise<UnsafeObject>;
  revokeToken(config: UnsafeObject): Promise<void>;
  verifyToken(config: UnsafeObject): Promise<UnsafeObject>;
  generatePkcePair(): Promise<UnsafeObject>;
  handleURL(url: string): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>(
  "KrdpassAuthReactNative",
);

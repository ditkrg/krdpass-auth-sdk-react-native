import type { TurboModule } from "react-native";
import type { UnsafeObject } from "react-native/Libraries/Types/CodegenTypes";
import { TurboModuleRegistry } from "react-native";

/**
 * The native bridge contract consumed by React Native Codegen.
 *
 * Keep this surface limited to bridge-safe primitives and object maps. The
 * public SDK maps these values into its richer exported types in `index.ts`.
 * `UnsafeObject` deliberately preserves the existing NSDictionary/ReadableMap
 * ABI while the native implementations are migrated to generated bindings.
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

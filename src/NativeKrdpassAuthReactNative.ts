import type { CodegenTypes, TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

/**
 * The native bridge contract consumed by React Native Codegen. `UnsafeObject` is
 * deliberate: the claim maps are open-ended (Codegen cannot express them) and a
 * Codegen struct would flatten authenticate's discriminated union. The richer
 * public types live in `index.ts`.
 */
export interface Spec extends TurboModule {
  signIn(config: CodegenTypes.UnsafeObject): Promise<CodegenTypes.UnsafeObject>;
  authenticate(
    config: CodegenTypes.UnsafeObject,
  ): Promise<CodegenTypes.UnsafeObject>;
  cancelAuthentication(config: CodegenTypes.UnsafeObject): Promise<boolean>;
  getUserInfo(
    config: CodegenTypes.UnsafeObject,
  ): Promise<CodegenTypes.UnsafeObject>;
  refreshTokens(
    config: CodegenTypes.UnsafeObject,
  ): Promise<CodegenTypes.UnsafeObject>;
  revokeToken(config: CodegenTypes.UnsafeObject): Promise<void>;
  verifyToken(
    config: CodegenTypes.UnsafeObject,
  ): Promise<CodegenTypes.UnsafeObject>;
  generatePkcePair(): Promise<CodegenTypes.UnsafeObject>;
  handleURL(url: string): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>(
  "KrdpassAuthReactNative",
);

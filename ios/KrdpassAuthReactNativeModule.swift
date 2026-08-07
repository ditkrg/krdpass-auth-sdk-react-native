import Foundation
@preconcurrency import React
import KrdpassAuth

/**
 * Authentication implementation behind the Objective-C++ React Native facade. Kept separate so
 * the facade satisfies Codegen's generated protocol without exposing Swift runtime details to
 * the TurboModule registry.
 *
 * Every promise rejection code here is a lowercase wire code shared with the Android, iOS and
 * Flutter SDKs, and is the public contract the JS layer turns into KrdpassAuthError.code. Do
 * not invent a new one, and never an UPPERCASE one.
 */
@MainActor
@objc(KrdpassAuthReactNativeModule)
public final class KrdpassAuthReactNativeModule: NSObject, @unchecked Sendable {
  private var activeAuth: KrdpassAuth?

  @objc public static func requiresMainQueueSetup() -> Bool { true }

  @objc(signIn:resolve:rejecter:)
  public func signIn(
    _ config: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let clientId = config["clientId"] as? String else {
      reject("invalid_request", "clientId is required", nil)
      return
    }
    guard let redirectUri = config["redirectUri"] as? String else {
      reject("invalid_request", "redirectUri is required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    let scopes = (config["scopes"] as? String)?.split(separator: " ").map(String.init) ?? ["openid", "profile"]
    let timeout = (config["timeout"] as? NSNumber)?.doubleValue ?? 300

    Task { @MainActor in
      if self.activeAuth?.isAuthenticating == true {
        reject("busy", AuthError.busy.message, nil)
        return
      }
      self.activeAuth = KrdpassAuth(config: KrdpassConfig(clientId: clientId, redirectUri: redirectUri, environment: environment))
      do {
        guard let tokens = try await self.activeAuth?.signIn(scopes: scopes, timeout: timeout) else {
          reject("authentication_failed", "Unknown error", nil)
          return
        }
        resolve(Self.tokensToMap(tokens))
      } catch let error as KrdpassError {
        if case .authenticationFailed(let message, let code) = error {
          reject(code ?? "authentication_failed", message, error)
        } else {
          reject(error.code ?? "authentication_failed", error.errorDescription ?? "Authentication failed", error)
        }
      } catch {
        reject("network_error", error.localizedDescription, error)
      }
    }
  }

  @objc(getUserInfo:resolve:rejecter:)
  public func getUserInfo(
    _ config: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let clientId = config["clientId"] as? String else {
      reject("invalid_request", "clientId is required", nil)
      return
    }
    guard let token = config["accessToken"] as? String, !token.isEmpty else {
      reject("invalid_request", "accessToken is required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    Task { @MainActor in
      do {
        let auth = KrdpassAuth(config: KrdpassConfig(clientId: clientId, redirectUri: "", environment: environment))
        // rawJsonObject, not raw: raw is [String: JSONValue], which the bridge cannot serialize
        // (resolve takes Any, so it would compile and deliver garbage to JS).
        resolve(try await auth.getUserInfo(accessToken: token).rawJsonObject)
      } catch {
        reject(Self.sdkErrorCode(error) ?? "user_info_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(refreshTokens:resolve:rejecter:)
  public func refreshTokens(
    _ config: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let clientId = config["clientId"] as? String else {
      reject("invalid_request", "clientId required", nil)
      return
    }
    guard let refreshToken = config["refreshToken"] as? String else {
      reject("invalid_request", "refreshToken required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    Task { @MainActor in
      do {
        let auth = KrdpassAuth(config: KrdpassConfig(clientId: clientId, redirectUri: "", environment: environment))
        resolve(Self.tokensToMap(try await auth.refreshTokens(refreshToken: refreshToken, scope: config["scope"] as? String)))
      } catch {
        reject(Self.sdkErrorCode(error) ?? "refresh_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(revokeToken:resolve:rejecter:)
  public func revokeToken(
    _ config: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let clientId = config["clientId"] as? String else {
      reject("invalid_request", "clientId required", nil)
      return
    }
    guard let token = config["token"] as? String else {
      reject("invalid_request", "token required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    Task { @MainActor in
      do {
        let auth = KrdpassAuth(config: KrdpassConfig(clientId: clientId, redirectUri: "", environment: environment))
        try await auth.revokeToken(token: token, tokenTypeHint: config["tokenTypeHint"] as? String)
        resolve(nil)
      } catch {
        reject(Self.sdkErrorCode(error) ?? "revoke_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(verifyToken:resolve:rejecter:)
  public func verifyToken(
    _ config: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let clientId = config["clientId"] as? String else {
      reject("invalid_request", "clientId required", nil)
      return
    }
    guard let idToken = config["idToken"] as? String else {
      reject("invalid_request", "idToken required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    let clockSkew = (config["clockSkew"] as? NSNumber)?.doubleValue ?? 60
    Task { @MainActor in
      do {
        let auth = KrdpassAuth(config: KrdpassConfig(clientId: clientId, redirectUri: "", environment: environment))
        resolve(try await auth.verifyToken(idToken: idToken, clockSkew: clockSkew))
      } catch {
        reject(Self.verifyErrorCode(error), error.localizedDescription, error)
      }
    }
  }

  @objc(generatePkcePair:rejecter:)
  public func generatePkcePair(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Task { @MainActor in
      do {
        let auth = KrdpassAuth(config: KrdpassConfig(clientId: "", redirectUri: "", environment: .production))
        let pair = try auth.generatePkcePair()
        resolve(["codeVerifier": pair.codeVerifier, "codeChallenge": pair.codeChallenge])
      } catch {
        reject("pkce_generation_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(authenticate:resolve:rejecter:)
  public func authenticate(
    _ config: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject _: @escaping RCTPromiseRejectBlock
  ) {
    guard let clientId = config["clientId"] as? String, !clientId.isEmpty else {
      resolve(["error": "platform_error", "error_description": "clientId is required"])
      return
    }
    guard let redirectUri = config["redirectUri"] as? String, !redirectUri.isEmpty else {
      resolve(["error": "platform_error", "error_description": "redirectUri is required"])
      return
    }
    guard let requestUri = config["requestUri"] as? String, !requestUri.isEmpty else {
      resolve(["error": "platform_error", "error_description": "requestUri is required"])
      return
    }
    let timeout = (config["timeout"] as? NSNumber)?.doubleValue ?? 300
    guard timeout > 0 else {
      resolve(["error": "platform_error", "error_description": "timeout must be a positive number of seconds"])
      return
    }
    let environment: KrdpassEnvironment
    do {
      environment = try parseEnvironment(config["environment"])
    } catch {
      resolve(["error": "platform_error", "error_description": error.localizedDescription])
      return
    }
    let state = config["state"] as? String
    Task { @MainActor in
      if self.activeAuth?.isAuthenticating == true {
        resolve(["error": "busy", "error_description": AuthError.busy.message])
        return
      }
      self.activeAuth = KrdpassAuth(config: KrdpassConfig(clientId: clientId, redirectUri: redirectUri, environment: environment))
      let result = await self.activeAuth?.authenticate(requestUri: requestUri, state: state, timeout: timeout)
      switch result {
      case .success(let response):
        resolve(["code": response.code, "state": response.state as Any])
      case .cancelled(let rawDescription):
        resolve(["error": "cancelled", "error_description": rawDescription ?? AuthError.cancelled.message])
      case .timeout:
        resolve(["error": "timeout", "error_description": AuthError.timeout.message])
      case .busy:
        resolve(["error": "busy", "error_description": AuthError.busy.message])
      case .error(let error):
        resolve(["error": error.error, "error_description": error.errorDescription ?? error.error])
      case .none:
        resolve(["error": "platform_error", "error_description": "Unknown error"])
      }
    }
  }

  @objc(cancelAuthentication:resolve:rejecter:)
  public func cancelAuthentication(
    _ config: NSDictionary?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject _: @escaping RCTPromiseRejectBlock
  ) {
    let timeout = (config?["timeout"] as? Bool) ?? false
    Task { @MainActor in
      guard let auth = self.activeAuth, auth.isAuthenticating else {
        resolve(false)
        return
      }
      auth.cancelPendingAuthentication(timeout: timeout)
      resolve(true)
    }
  }

  @objc(handleURL:)
  public func handleURL(_ url: String) {
    guard let parsed = URL(string: url) else { return }
    Task { @MainActor in
      _ = self.activeAuth?.handle(parsed)
    }
  }

  private func parseEnvironment(_ value: Any?) throws -> KrdpassEnvironment {
    guard let value else { return .production }
    switch (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
    case "PRODUCTION": return .production
    case "DEVELOPMENT", "DEV": return .development
    default:
      throw NSError(domain: "KrdpassAuthReactNative", code: 1001, userInfo: [NSLocalizedDescriptionKey: "environment must be PRODUCTION or DEVELOPMENT"])
    }
  }

  private func parseEnvironmentOrReject(
    _ config: NSDictionary,
    _ reject: @escaping RCTPromiseRejectBlock
  ) -> KrdpassEnvironment? {
    do { return try parseEnvironment(config["environment"]) }
    catch {
      reject("invalid_request", error.localizedDescription, error)
      return nil
    }
  }

  /// The core SDK's own wire code for the error (`network_error`, `timeout`, a structured server
  /// code), or nil when it carries none. Every rejection path appends its per-call fallback with
  /// `??`, so a transient failure keeps its retryable code instead of flattening to the permanent
  /// per-call one (refresh_failed, revoke_failed, user_info_failed, ...), which the docs tell
  /// apps not to retry. The token entry points only throw KrdpassError (the core's
  /// translatingCasErrors guarantees it), so nil here means "no more specific code", not an
  /// untranslated error type.
  private static func sdkErrorCode(_ error: Error) -> String? {
    (error as? KrdpassError)?.code
  }

  /// Forward the core's own verifyToken classification (`invalid_id_token` for signature/claims,
  /// `network_error` for an unfetchable JWKS); `verification_failed` is only the fallback when it
  /// has none. Flattening everything to `verification_failed` hides the retryable case.
  private static func verifyErrorCode(_ error: Error) -> String {
    sdkErrorCode(error) ?? "verification_failed"
  }

  private static func tokensToMap(_ tokens: KrdpassTokenResult) -> [String: Any?] {
    [
      "accessToken": tokens.accessToken,
      "idToken": tokens.idToken,
      "refreshToken": tokens.refreshToken,
      "expiresIn": tokens.expiresIn,
      "tokenType": tokens.tokenType,
      "scope": tokens.scope,
    ]
  }
}

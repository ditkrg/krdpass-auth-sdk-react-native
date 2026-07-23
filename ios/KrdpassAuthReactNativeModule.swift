import Foundation
@preconcurrency import React
import KrdpassAuth

/**
 * Authentication implementation used by the Objective-C++ React Native
 * facade. Keeping the Swift implementation separate lets the facade satisfy
 * Codegen's generated protocol without exposing Swift runtime details to the
 * TurboModule registry.
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
      reject("CONFIG_ERROR", "clientId is required", nil)
      return
    }
    guard let redirectUri = config["redirectUri"] as? String else {
      reject("CONFIG_ERROR", "redirectUri is required", nil)
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
          reject("AUTH_FAILED", "Unknown error", nil)
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
      reject("CONFIG_ERROR", "clientId is required", nil)
      return
    }
    guard let token = config["accessToken"] as? String, !token.isEmpty else {
      reject("INVALID_ARGS", "accessToken is required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    Task { @MainActor in
      do {
        let auth = KrdpassAuth(config: KrdpassConfig(clientId: clientId, redirectUri: "", environment: environment))
        resolve(try await auth.getUserInfo(accessToken: token).raw)
      } catch {
        reject("USER_INFO_ERROR", error.localizedDescription, error)
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
      reject("CONFIG_ERROR", "clientId required", nil)
      return
    }
    guard let refreshToken = config["refreshToken"] as? String else {
      reject("INVALID_ARGS", "refreshToken required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    Task { @MainActor in
      do {
        let auth = KrdpassAuth(config: KrdpassConfig(clientId: clientId, redirectUri: "", environment: environment))
        resolve(Self.tokensToMap(try await auth.refreshTokens(refreshToken: refreshToken, scope: config["scope"] as? String)))
      } catch {
        reject("REFRESH_ERROR", error.localizedDescription, error)
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
      reject("CONFIG_ERROR", "clientId required", nil)
      return
    }
    guard let token = config["token"] as? String else {
      reject("INVALID_ARGS", "token required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    Task { @MainActor in
      do {
        let auth = KrdpassAuth(config: KrdpassConfig(clientId: clientId, redirectUri: "", environment: environment))
        try await auth.revokeToken(token: token, tokenTypeHint: config["tokenTypeHint"] as? String)
        resolve(nil)
      } catch {
        reject("REVOKE_ERROR", error.localizedDescription, error)
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
      reject("CONFIG_ERROR", "clientId required", nil)
      return
    }
    guard let idToken = config["idToken"] as? String else {
      reject("INVALID_ARGS", "idToken required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    let clockSkew = (config["clockSkew"] as? NSNumber)?.doubleValue ?? 60
    Task { @MainActor in
      do {
        let auth = KrdpassAuth(config: KrdpassConfig(clientId: clientId, redirectUri: "", environment: environment))
        resolve(try await auth.verifyToken(idToken: idToken, clockSkew: clockSkew))
      } catch {
        reject("VERIFY_ERROR", error.localizedDescription, error)
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
        reject("PKCE_ERROR", error.localizedDescription, error)
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
      case .cancelled:
        resolve(["error": "cancelled", "error_description": AuthError.cancelled.message])
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
      reject("CONFIG_ERROR", error.localizedDescription, error)
      return nil
    }
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

import Foundation
@preconcurrency import React
import KrdpassAuth

/**
 * Authentication implementation behind the Objective-C++ React Native facade, kept separate so
 * the facade satisfies Codegen's generated protocol without exposing Swift runtime details.
 * Every promise rejection code is a lowercase wire code shared with the Android, iOS and
 * Flutter SDKs: do not invent a new one, and never an UPPERCASE one.
 */
@MainActor
@objc(KrdpassAuthReactNativeModule)
public final class KrdpassAuthReactNativeModule: NSObject {
  private var activeAuth: KrdpassAuth?
  /// Claimed in the same MainActor turn that constructs the KrdpassAuth below, so two calls
  /// awaiting their way in cannot both pass the busy check and race for activeAuth.
  private var inFlight = false

  @objc public static func requiresMainQueueSetup() -> Bool { true }

  /// React Native teardown. Without this the pending authentication and its promise survive
  /// the bridge that owns them.
  @objc nonisolated public func teardown() {
    Task { @MainActor in
      self.activeAuth?.cancelPendingAuthentication(timeout: false)
      self.activeAuth = nil
      self.inFlight = false
    }
  }

  @objc(signIn:resolve:rejecter:)
  public func signIn(
    _ config: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let clientId = Self.requiredArg(config, "clientId") else {
      reject("invalid_request", "clientId is required", nil)
      return
    }
    guard let redirectUri = Self.requiredArg(config, "redirectUri") else {
      reject("invalid_request", "redirectUri is required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    let scopes = (config["scopes"] as? String)?.split(separator: " ").map(String.init) ?? ["openid", "profile"]
    // A bad timeout is rejected, never silently replaced with the default.
    let timeout = (config["timeout"] as? NSNumber)?.doubleValue ?? 300
    guard timeout > 0, timeout.isFinite else {
      reject("platform_error", "timeout must be a positive number of seconds", nil)
      return
    }

    Task { @MainActor in
      if self.inFlight {
        reject("busy", AuthResult.busy.message, nil)
        return
      }
      self.inFlight = true
      let auth = KrdpassAuth(config: KrdpassConfig(clientId: clientId, redirectUri: redirectUri, environment: environment))
      self.activeAuth = auth
      defer { self.release(auth) }
      do {
        resolve(Self.tokensToMap(try await auth.signIn(scopes: scopes, timeout: timeout)))
      } catch let error as KrdpassError {
        if case .authenticationFailed(let message, let code) = error {
          reject(code ?? "authentication_failed", message, error)
        } else {
          reject(error.code ?? "authentication_failed", error.errorDescription ?? "Authentication failed", error)
        }
      } catch {
        // signIn only throws KrdpassError (the branch above), so anything here carries no
        // classification and must not claim to be retryable.
        reject("authentication_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(getUserInfo:resolve:rejecter:)
  public func getUserInfo(
    _ config: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let clientId = Self.requiredArg(config, "clientId") else {
      reject("invalid_request", "clientId is required", nil)
      return
    }
    guard let token = Self.requiredArg(config, "accessToken") else {
      reject("invalid_request", "accessToken is required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    perform(clientId: clientId, environment: environment, fallback: "user_info_failed", resolve: resolve, reject: reject) { auth in
      // rawJsonObject, not raw: raw is [String: JSONValue], which the bridge cannot serialize
      // (resolve takes Any, so it would compile and deliver garbage to JS).
      try await auth.getUserInfo(accessToken: token).rawJsonObject
    }
  }

  @objc(refreshTokens:resolve:rejecter:)
  public func refreshTokens(
    _ config: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let clientId = Self.requiredArg(config, "clientId") else {
      reject("invalid_request", "clientId is required", nil)
      return
    }
    guard let refreshToken = Self.requiredArg(config, "refreshToken") else {
      reject("invalid_request", "refreshToken is required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    let scope = config["scope"] as? String
    perform(clientId: clientId, environment: environment, fallback: "refresh_failed", resolve: resolve, reject: reject) { auth in
      Self.tokensToMap(try await auth.refreshTokens(refreshToken: refreshToken, scope: scope))
    }
  }

  @objc(revokeToken:resolve:rejecter:)
  public func revokeToken(
    _ config: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let clientId = Self.requiredArg(config, "clientId") else {
      reject("invalid_request", "clientId is required", nil)
      return
    }
    guard let token = Self.requiredArg(config, "token") else {
      reject("invalid_request", "token is required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    let tokenTypeHint = config["tokenTypeHint"] as? String
    perform(clientId: clientId, environment: environment, fallback: "revoke_failed", resolve: resolve, reject: reject) { auth in
      try await auth.revokeToken(token: token, tokenTypeHint: tokenTypeHint)
      return nil
    }
  }

  @objc(verifyToken:resolve:rejecter:)
  public func verifyToken(
    _ config: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let clientId = Self.requiredArg(config, "clientId") else {
      reject("invalid_request", "clientId is required", nil)
      return
    }
    guard let idToken = Self.requiredArg(config, "idToken") else {
      reject("invalid_request", "idToken is required", nil)
      return
    }
    guard let environment = parseEnvironmentOrReject(config, reject) else { return }
    let clockSkew = (config["clockSkew"] as? NSNumber)?.doubleValue ?? 60
    perform(clientId: clientId, environment: environment, fallback: "verification_failed", resolve: resolve, reject: reject) { auth in
      try await auth.verifyToken(idToken: idToken, clockSkew: clockSkew)
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
    guard let clientId = Self.requiredArg(config, "clientId") else {
      resolve(["error": "platform_error", "error_description": "clientId is required"])
      return
    }
    guard let redirectUri = Self.requiredArg(config, "redirectUri") else {
      resolve(["error": "platform_error", "error_description": "redirectUri is required"])
      return
    }
    guard let requestUri = Self.requiredArg(config, "requestUri") else {
      resolve(["error": "platform_error", "error_description": "requestUri is required"])
      return
    }
    let timeout = (config["timeout"] as? NSNumber)?.doubleValue ?? 300
    guard timeout > 0, timeout.isFinite else {
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
    // requiredArg trims only to validate: the core must see the backend's PAR state
    // byte-identical.
    guard let state = Self.requiredArg(config, "state") else {
      resolve(["error": "platform_error", "error_description": "state is required"])
      return
    }
    Task { @MainActor in
      if self.inFlight {
        resolve(Self.authResultFields(.busy))
        return
      }
      self.inFlight = true
      let auth = KrdpassAuth(config: KrdpassConfig(clientId: clientId, redirectUri: redirectUri, environment: environment))
      self.activeAuth = auth
      defer { self.release(auth) }
      resolve(Self.authResultFields(await auth.authenticate(requestUri: requestUri, state: state, timeout: timeout)))
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
      // Same gate the busy check uses, so "was a flow pending?" has one answer per platform.
      guard self.inFlight else {
        resolve(false)
        return
      }
      self.activeAuth?.cancelPendingAuthentication(timeout: timeout)
      // Matches Android: a repeat cancel resolves false. The unwinding flow's own
      // release(auth) identity guard makes clearing here safe.
      self.inFlight = false
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

  /// Runs `body` against a fresh KrdpassAuth for the four token calls. The core's own code wins
  /// on failure; `fallback` fills in only when it carries none, so a transient network_error is
  /// never reported as a permanent per-call failure. redirectUri is empty on purpose: none of
  /// these calls launches KRDPASS.
  private func perform(
    clientId: String,
    environment: KrdpassEnvironment,
    fallback: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock,
    _ body: @escaping (KrdpassAuth) async throws -> Any?
  ) {
    Task { @MainActor in
      do {
        let auth = KrdpassAuth(config: KrdpassConfig(clientId: clientId, redirectUri: "", environment: environment))
        resolve(try await body(auth))
      } catch {
        reject(Self.sdkErrorCode(error) ?? fallback, error.localizedDescription, error)
      }
    }
  }

  /// Clears the in-flight state only if `auth` still owns it: a teardown can hand ownership to
  /// a newer flow while this one is unwinding, and clearing then would kill its URL routing.
  private func release(_ auth: KrdpassAuth) {
    guard self.activeAuth === auth else { return }
    self.activeAuth = nil
    self.inFlight = false
  }

  /// Accepts exactly the two names the JS layer's own validation accepts (any case, trimmed);
  /// absent or null means production. Kept in step with BridgeMapping.environment on Android.
  /// NSNull is checked as well as nil: an omitted JS key arrives as nil, but an explicit
  /// `environment: null` arrives as NSNull.
  private func parseEnvironment(_ value: Any?) throws -> KrdpassEnvironment {
    guard let value, !(value is NSNull) else { return .production }
    switch (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
    case "PRODUCTION": return .production
    case "DEVELOPMENT": return .development
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

  /// The core SDK's own wire code for the error, or nil when it carries none so the call site
  /// can apply its per-call fallback. The token entry points only throw KrdpassError, so nil
  /// means "no more specific code", not an untranslated error type.
  private static func sdkErrorCode(_ error: Error) -> String? {
    (error as? KrdpassError)?.code
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

  /// The JS object for an `AuthResult`: `code`/`state` on success, `error`/`error_description`
  /// otherwise. A nil description omits the key, matching Android: absent means "neither side
  /// supplied one". Counterpart of BridgeMapping.authResultFields on Android.
  private static func authResultFields(_ result: AuthResult) -> [String: Any] {
    let code: String
    let description: String?
    switch result {
    case .success(let response):
      return ["code": response.code, "state": response.state as Any]
    case .cancelled: code = "cancelled"; description = result.message
    case .timeout: code = "timeout"; description = result.message
    case .busy: code = "busy"; description = result.message
    case .error(let error):
      code = error.error
      description = error.errorDescription
    }
    var fields: [String: Any] = ["error": code]
    if let description {
      fields["error_description"] = description
    }
    return fields
  }

  /// The non-blank string for `key`, or nil: blank and absent classify identically on every
  /// method, matching Android's requireArg.
  private static func requiredArg(_ config: NSDictionary, _ key: String) -> String? {
    guard let value = config[key] as? String,
      !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { return nil }
    return value
  }
}

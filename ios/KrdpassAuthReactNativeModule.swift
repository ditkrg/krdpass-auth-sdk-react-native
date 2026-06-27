import ExpoModulesCore
import KrdpassAuth

public class KrdpassAuthReactNativeModule: Module {
  private var activeAuth: KrdpassAuth?

  public func definition() -> ModuleDefinition {
    Name("KrdpassAuthReactNative")

    AsyncFunction("signIn") { (config: [String: Any], promise: Promise) in
      guard let clientId = config["clientId"] as? String else {
        promise.reject("CONFIG_ERROR", "clientId is required")
        return
      }
      guard let redirectUri = config["redirectUri"] as? String else {
        promise.reject("CONFIG_ERROR", "redirectUri is required")
        return
      }
      
      let scopes = (config["scopes"] as? String)?.components(separatedBy: " ").filter { !$0.isEmpty } ?? ["openid", "profile"]
      // Honor an optional timeout (seconds) so iOS matches Android's signIn timeout behavior.
      let timeout = (config["timeout"] as? NSNumber)?.doubleValue ?? 300

      let environment: KrdpassEnvironment
      do {
        environment = try parseEnvironment(config["environment"])
      } catch {
        promise.reject("CONFIG_ERROR", error.localizedDescription)
        return
      }
      
      Task { @MainActor in
        if self.activeAuth?.isAuthenticating == true {
          promise.reject("BUSY", "Another authentication is in progress")
          return
        }

        let krdpassConfig = KrdpassConfig(clientId: clientId, redirectUri: redirectUri, environment: environment)
        self.activeAuth = KrdpassAuth(config: krdpassConfig)
        do {
            let result = try await self.activeAuth?.signIn(scopes: scopes, timeout: timeout)
            if let tokens = result {
                 promise.resolve([
                    "accessToken": tokens.accessToken,
                    "idToken": tokens.idToken,
                    "refreshToken": tokens.refreshToken,
                    "expiresIn": tokens.expiresIn,
                    "tokenType": tokens.tokenType,
                    "scope": tokens.scope
                 ])
            } else {
                 promise.reject("AUTH_FAILED", "Unknown error")
            }
        } catch let error as KrdpassError {
            promise.reject("AUTH_FAILED", String(describing: error))
        } catch {
            promise.reject("AUTH_FAILED", error.localizedDescription)
        }
      }
    }

    AsyncFunction("getUserInfo") { (config: [String: Any], promise: Promise) in
      guard let clientId = config["clientId"] as? String else {
        promise.reject("CONFIG_ERROR", "clientId is required")
        return
      }
      let accessToken = config["accessToken"] as? String
      guard let token = accessToken, !token.isEmpty else {
        promise.reject("INVALID_ARGS", "accessToken is required")
        return
      }
      
      let environment: KrdpassEnvironment
      do {
        environment = try parseEnvironment(config["environment"])
      } catch {
        promise.reject("CONFIG_ERROR", error.localizedDescription)
        return
      }
      
      Task { @MainActor in
        let krdpassConfig = KrdpassConfig(clientId: clientId, redirectUri: "", environment: environment)
        let auth = KrdpassAuth(config: krdpassConfig)
        do {
            let info = try await auth.getUserInfo(accessToken: token)
            promise.resolve(info.raw)
        } catch {
            promise.reject("USER_INFO_ERROR", error.localizedDescription)
        }
      }
    }

    AsyncFunction("refreshTokens") { (config: [String: Any], promise: Promise) in
       guard let clientId = config["clientId"] as? String else { return promise.reject("CONFIG_ERROR", "clientId required") }
       guard let refreshToken = config["refreshToken"] as? String else { return promise.reject("INVALID_ARGS", "refreshToken required") }
       let scope = config["scope"] as? String
       
       let environment: KrdpassEnvironment
       do {
         environment = try parseEnvironment(config["environment"])
       } catch {
         promise.reject("CONFIG_ERROR", error.localizedDescription)
         return
       }

       Task { @MainActor in
         let krdpassConfig = KrdpassConfig(clientId: clientId, redirectUri: "", environment: environment)
         let auth = KrdpassAuth(config: krdpassConfig)
         do {
            let result = try await auth.refreshTokens(refreshToken: refreshToken, scope: scope)
            promise.resolve([
                    "accessToken": result.accessToken,
                    "idToken": result.idToken,
                    "refreshToken": result.refreshToken,
                    "expiresIn": result.expiresIn,
                    "tokenType": result.tokenType,
                    "scope": result.scope
            ])
         } catch {
            promise.reject("REFRESH_ERROR", error.localizedDescription)
         }
       }
    }

    AsyncFunction("revokeToken") { (config: [String: Any], promise: Promise) in
       guard let clientId = config["clientId"] as? String else { return promise.reject("CONFIG_ERROR", "clientId required") }
       guard let token = config["token"] as? String else { return promise.reject("INVALID_ARGS", "token required") }
       let tokenTypeHint = config["tokenTypeHint"] as? String
       
       let environment: KrdpassEnvironment
       do {
         environment = try parseEnvironment(config["environment"])
       } catch {
         promise.reject("CONFIG_ERROR", error.localizedDescription)
         return
       }

       Task { @MainActor in
         let krdpassConfig = KrdpassConfig(clientId: clientId, redirectUri: "", environment: environment)
         let auth = KrdpassAuth(config: krdpassConfig)
         do {
            try await auth.revokeToken(token: token, tokenTypeHint: tokenTypeHint)
            promise.resolve(nil)
         } catch {
            promise.reject("REVOKE_ERROR", error.localizedDescription)
         }
       }
    }

    AsyncFunction("verifyToken") { (config: [String: Any], promise: Promise) in
       guard let clientId = config["clientId"] as? String else { return promise.reject("CONFIG_ERROR", "clientId required") }
       guard let idToken = config["idToken"] as? String else { return promise.reject("INVALID_ARGS", "idToken required") }
       
       let environment: KrdpassEnvironment
       do {
         environment = try parseEnvironment(config["environment"])
       } catch {
         promise.reject("CONFIG_ERROR", error.localizedDescription)
         return
       }

       Task { @MainActor in
         let krdpassConfig = KrdpassConfig(clientId: clientId, redirectUri: "", environment: environment)
         let auth = KrdpassAuth(config: krdpassConfig)
         do {
            // verifyToken derives the audience from the configured clientId.
            let claims = try await auth.verifyToken(idToken: idToken)
            promise.resolve(claims)
         } catch {
            promise.reject("VERIFY_ERROR", error.localizedDescription)
         }
       }
    }

    AsyncFunction("generatePkcePair") { (promise: Promise) in
       Task { @MainActor in
         let krdpassConfig = KrdpassConfig(clientId: "", redirectUri: "", environment: .production)
         let auth = KrdpassAuth(config: krdpassConfig)
         do {
            let pkcePair = try auth.generatePkcePair()
            promise.resolve([
               "codeVerifier": pkcePair.codeVerifier,
               "codeChallenge": pkcePair.codeChallenge
            ])
         } catch {
            promise.reject("PKCE_ERROR", error.localizedDescription)
         }
       }
    }

    AsyncFunction("authenticate") { (config: [String: Any], promise: Promise) in
       guard let clientId = config["clientId"] as? String, !clientId.isEmpty else {
         promise.resolve(["error": "platform_error", "error_description": "clientId is required"])
         return
       }
       guard let redirectUri = config["redirectUri"] as? String, !redirectUri.isEmpty else {
         promise.resolve(["error": "platform_error", "error_description": "redirectUri is required"])
         return
       }
       guard let requestUri = config["requestUri"] as? String, !requestUri.isEmpty else {
         promise.resolve(["error": "platform_error", "error_description": "requestUri is required"])
         return
       }
       let state = config["state"] as? String
       let timeoutSeconds = (config["timeout"] as? NSNumber)?.doubleValue
       if let timeoutSeconds, timeoutSeconds <= 0 {
         promise.resolve([
           "error": "platform_error",
           "error_description": "timeout must be a positive number of seconds",
         ])
         return
       }
       
       let environment: KrdpassEnvironment
       do {
         environment = try parseEnvironment(config["environment"])
       } catch {
         promise.resolve(["error": "platform_error", "error_description": error.localizedDescription])
         return
       }
       
       Task { @MainActor in
         if self.activeAuth?.isAuthenticating == true {
           promise.resolve(["error": "busy", "error_description": "Another authentication is in progress"])
           return
         }

         let krdpassConfig = KrdpassConfig(clientId: clientId, redirectUri: redirectUri, environment: environment)
         self.activeAuth = KrdpassAuth(config: krdpassConfig)
         
         let result = await self.activeAuth?.authenticate(
           requestUri: requestUri,
           state: state,
           timeout: timeoutSeconds ?? 300.0
         )
         switch result {
         case .success(let response):
            promise.resolve([
               "code": response.code,
               "state": response.state as Any
            ])
         case .cancelled:
            promise.resolve(["error": "cancelled", "error_description": "User cancelled authentication"])
         case .timeout:
            promise.resolve(["error": "timeout", "error_description": "Authentication timed out"])
         case .busy:
            promise.resolve(["error": "busy", "error_description": "Another authentication is in progress"])
         case .error(let error):
            promise.resolve(["error": error.error, "error_description": error.description ?? error.error])
         case .none:
            promise.resolve(["error": "platform_error", "error_description": "Unknown error"])
         }
       }
    }

    AsyncFunction("cancelAuthentication") { (config: [String: Any]?, promise: Promise) in
      let timeout = (config?["timeout"] as? Bool) ?? false
      Task { @MainActor in
        guard let auth = self.activeAuth, auth.isAuthenticating else {
          promise.resolve(false)
          return
        }
        auth.cancelPendingAuthentication(timeout: timeout)
        promise.resolve(true)
      }
    }


    Function("handleURL") { (url: String) -> Bool in
       guard let nsUrl = URL(string: url) else { return false }
       if Thread.isMainThread {
           return MainActor.assumeIsolated {
             guard let auth = self.activeAuth else { return false }
             return auth.handle(nsUrl)
           }
       }
       let semaphore = DispatchSemaphore(value: 0)
       var handled = false
       Task { @MainActor in
         if let auth = self.activeAuth {
           handled = auth.handle(nsUrl)
         }
         semaphore.signal()
       }
       semaphore.wait()
       return handled
    }
  }

  private func parseEnvironment(_ value: Any?) throws -> KrdpassEnvironment {
    if value == nil {
      return .production
    }
    guard let envStr = (value as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .uppercased()
    else {
      throw NSError(
        domain: "KrdpassAuthReactNative",
        code: 1001,
        userInfo: [NSLocalizedDescriptionKey: "environment must be PRODUCTION or DEVELOPMENT"]
      )
    }
    switch envStr {
    case "PRODUCTION":
      return .production
    case "DEVELOPMENT", "DEV":
      return .development
    default:
      throw NSError(
        domain: "KrdpassAuthReactNative",
        code: 1001,
        userInfo: [NSLocalizedDescriptionKey: "environment must be PRODUCTION or DEVELOPMENT"]
      )
    }
  }
}

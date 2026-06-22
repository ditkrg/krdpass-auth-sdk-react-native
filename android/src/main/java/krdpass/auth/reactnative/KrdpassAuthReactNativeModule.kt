package krdpass.auth.reactnative

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import krd.pass.auth.CasClient
import krd.pass.auth.KrdpassEnvironment
import krd.pass.auth.PkceGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import kotlin.math.abs
import java.util.Locale
import java.util.Date

class KrdpassAuthReactNativeModule : Module() {
  private val scope = CoroutineScope(Dispatchers.IO)
  private var currentPromise: Promise? = null
  private var currentCodeVerifier: String? = null
  private var currentRedirectUri: String? = null
  private var currentCasClient: CasClient? = null
  private var currentState: String? = null
  // signIn() only: bound into PAR and verified against the returned id_token (replay protection).
  private var currentNonce: String? = null
  private var currentClientId: String? = null
  private var currentEnvironment: KrdpassEnvironment? = null
  private var currentAuthTimeoutJob: Job? = null

  companion object {
    private const val AUTH_REQUEST_CODE = 9988
  }

  override fun definition() = ModuleDefinition {
    Name("KrdpassAuthReactNative")

    val module = this@KrdpassAuthReactNativeModule

    AsyncFunction("signIn") { config: Map<String, Any>, promise: Promise ->
      if (module.currentPromise != null) {
        promise.reject("BUSY", "Another authentication is in progress", null)
        return@AsyncFunction
      }

      val clientId = config["clientId"] as? String ?: run {
        promise.reject("CONFIG_ERROR", "clientId is required", null)
        return@AsyncFunction
      }
      val redirectUri = config["redirectUri"] as? String ?: run {
        promise.reject("CONFIG_ERROR", "redirectUri is required", null)
        return@AsyncFunction
      }
      val scopesStr = config["scopes"] as? String ?: "openid profile"
      val scopes = scopesStr.split(" ").filter { it.isNotBlank() }
      val timeoutSeconds = (config["timeout"] as? Number)?.toDouble()?.takeIf { it > 0 && it.isFinite() } ?: 300.0

      val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return@AsyncFunction

      module.currentPromise = promise
      module.currentRedirectUri = redirectUri
      module.currentCasClient = CasClient(clientId, environment)
      module.currentCodeVerifier = null
      module.currentState = null
      module.currentNonce = null
      module.currentClientId = clientId
      module.currentEnvironment = environment

      module.scope.launch {
        try {
          // 1. Generate PKCE
          val pkce = PkceGenerator.generate()
          module.currentCodeVerifier = pkce.codeVerifier

          val stateBytes = ByteArray(32)
          SecureRandom().nextBytes(stateBytes)
          val state = Base64.encodeToString(stateBytes, Base64.URL_SAFE or Base64.NO_WRAP).replace("=", "")
          module.currentState = state

          // OIDC nonce: bound into PAR, verified against the id_token after exchange (replay protection).
          val nonceBytes = ByteArray(32)
          SecureRandom().nextBytes(nonceBytes)
          val nonce = Base64.encodeToString(nonceBytes, Base64.URL_SAFE or Base64.NO_WRAP).replace("=", "")
          module.currentNonce = nonce

          // 2. PAR
          val parResponse = module.currentCasClient!!.pushAuthorizationRequest(
             codeChallenge = pkce.codeChallenge,
             redirectUri = redirectUri,
             scopes = scopes,
             state = state,
             nonce = nonce
          )

          // 3. Launch Authenticator via startActivityForResult (to pass caller identity)
          val authUrl = Uri.parse(environment.authUrl).buildUpon()
             .appendQueryParameter("client_id", clientId)
             .appendQueryParameter("request_uri", parResponse.requestUri)
             .appendQueryParameter("redirect_uri", redirectUri)
             .appendQueryParameter("state", state)
             .build()

          withContext(Dispatchers.Main) {
             val activity = module.appContext.currentActivity
             if (activity == null) {
                promise.reject("NO_ACTIVITY", "Current activity is null", null)
                module.clearAuthState()
                return@withContext
             }
             // S1: verify KRDPass is installed with the expected signing cert before launching.
             val providerError = module.checkProviderInstalled(activity, environment)
             if (providerError != null) {
                module.resolveAuthError(promise, "provider_not_installed", providerError)
                module.clearAuthState()
                return@withContext
             }
             // S1: setPackage() locks the Intent to the KRDPass provider app.
             val intent = Intent(Intent.ACTION_VIEW, authUrl)
                .setPackage(environment.providerPackage)
             activity.startActivityForResult(intent, AUTH_REQUEST_CODE)
             // Schedule a timeout so an abandoned flow does not leave the module
             // stuck BUSY forever (the user may never return from KRDPass).
             module.scheduleAuthTimeout(timeoutSeconds)
          }

        } catch (e: Exception) {
           promise.reject("AUTH_ERROR", e.message, e)
           module.clearAuthState()
        }
      }
    }

    AsyncFunction("generatePkcePair") {
      val pkce = PkceGenerator.generate()
      mapOf(
        "codeVerifier" to pkce.codeVerifier,
        "codeChallenge" to pkce.codeChallenge
      )
    }

    AsyncFunction("authenticate") { config: Map<String, Any>, promise: Promise ->
      if (module.currentPromise != null) {
        module.resolveAuthError(promise, "busy", "Another authentication is in progress")
        return@AsyncFunction
      }

      val clientId = config["clientId"] as? String
      if (clientId.isNullOrBlank()) {
        module.resolveAuthError(promise, "platform_error", "clientId is required")
        return@AsyncFunction
      }
      val redirectUri = config["redirectUri"] as? String
      if (redirectUri.isNullOrBlank()) {
        module.resolveAuthError(promise, "platform_error", "redirectUri is required")
        return@AsyncFunction
      }
      val requestUri = config["requestUri"] as? String
      if (requestUri.isNullOrBlank()) {
        module.resolveAuthError(promise, "platform_error", "requestUri is required")
        return@AsyncFunction
      }
      val state = config["state"] as? String
      if (state.isNullOrBlank()) {
        module.resolveAuthError(promise, "invalid_request", "state is required and cannot be blank. Pass the state from your backend PAR call, or use signIn().")
        return@AsyncFunction
      }
      val timeoutSeconds = (config["timeout"] as? Number)?.toDouble() ?: 300.0
      if (timeoutSeconds <= 0 || !timeoutSeconds.isFinite()) {
        module.resolveAuthError(
          promise,
          "platform_error",
          "timeout must be a positive number of seconds"
        )
        return@AsyncFunction
      }

      val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return@AsyncFunction

      module.currentPromise = promise
      module.currentRedirectUri = redirectUri
      module.currentCodeVerifier = null // Signal that backend handles exchange
      module.currentState = state
      module.currentCasClient = CasClient(clientId, environment)

      // Build auth URL with the provided requestUri
      val builder = Uri.parse(environment.authUrl).buildUpon()
        .appendQueryParameter("client_id", clientId)
        .appendQueryParameter("request_uri", requestUri)
        .appendQueryParameter("redirect_uri", redirectUri)

      state?.let { builder.appendQueryParameter("state", it) }

      val authUrl = builder.build()

      module.scope.launch {
        withContext(Dispatchers.Main) {
          val activity = module.appContext.currentActivity
          if (activity == null) {
            module.resolveAuthError(promise, "platform_error", "Current activity is null")
            module.clearAuthState()
            return@withContext
          }
          // S1: verify KRDPass is installed with the expected signing cert before launching.
          val providerError = module.checkProviderInstalled(activity, environment)
          if (providerError != null) {
            module.resolveAuthError(promise, "provider_not_installed", providerError)
            module.clearAuthState()
            return@withContext
          }
          try {
            // S1: setPackage() locks the Intent to the KRDPass provider app.
            val intent = Intent(Intent.ACTION_VIEW, authUrl)
              .setPackage(environment.providerPackage)
            activity.startActivityForResult(intent, AUTH_REQUEST_CODE)
            module.scheduleAuthTimeout(timeoutSeconds)
          } catch (e: Exception) {
            module.resolveAuthError(
              promise,
              "launch_failed",
              e.message ?: "Failed to open KRDPass"
            )
            module.clearAuthState()
          }
        }
      }
    }

    AsyncFunction("cancelAuthentication") { config: Map<String, Any>? ->
      val timeout = (config?.get("timeout") as? Boolean) ?: false
      val pendingPromise = module.currentPromise
      if (pendingPromise != null) {
        if (timeout) {
          module.resolveAuthError(pendingPromise, "timeout", "Authentication timed out")
        } else {
          module.resolveAuthError(pendingPromise, "cancelled", "Authentication cancelled")
        }
        module.clearAuthState()
        true
      } else {
        false
      }
    }

    AsyncFunction("getUserInfo") { config: Map<String, Any>, promise: Promise ->
       val clientId = config["clientId"] as? String
       val accessToken = config["accessToken"] as? String

       if (clientId.isNullOrBlank()) {
          promise.reject("CONFIG_ERROR", "clientId is required in config", null)
          return@AsyncFunction
       }

       if (accessToken.isNullOrBlank()) {
          promise.reject("INVALID_ARGS", "accessToken is required in config", null)
          return@AsyncFunction
       }

       val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return@AsyncFunction

      module.scope.launch {
        try {
           val client = CasClient(clientId, environment)
           val info = client.getUserInfo(accessToken)
           promise.resolve(info.raw)
        } catch (e: Exception) {
           promise.reject("USER_INFO_ERROR", e.message, e)
        }
      }
    }

    AsyncFunction("refreshTokens") { config: Map<String, Any>, promise: Promise ->
       val clientId = config["clientId"] as? String ?: run { promise.reject("CONFIG_ERROR", "clientId required", null); return@AsyncFunction }
       val refreshToken = config["refreshToken"] as? String ?: run { promise.reject("INVALID_ARGS", "refreshToken required", null); return@AsyncFunction }
       val scopeParam = config["scope"] as? String

       val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return@AsyncFunction

       module.scope.launch {
         try {
            val client = CasClient(clientId, environment)
            val result = client.refreshTokens(refreshToken, scopeParam)
            promise.resolve(mapOf(
              "accessToken" to result.accessToken,
              "idToken" to result.idToken,
              "refreshToken" to result.refreshToken,
              "expiresIn" to result.expiresIn,
              "tokenType" to result.tokenType,
              "scope" to result.scope
            ))
         } catch (e: Exception) {
            promise.reject("REFRESH_ERROR", e.message, e)
         }
       }
    }

    AsyncFunction("revokeToken") { config: Map<String, Any>, promise: Promise ->
       val clientId = config["clientId"] as? String ?: run { promise.reject("CONFIG_ERROR", "clientId required", null); return@AsyncFunction }
       val token = config["token"] as? String ?: run { promise.reject("INVALID_ARGS", "token required", null); return@AsyncFunction }
       val tokenTypeHint = config["tokenTypeHint"] as? String

       val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return@AsyncFunction

       module.scope.launch {
         try {
            val client = CasClient(clientId, environment)
            client.revokeToken(token, tokenTypeHint)
            promise.resolve(null)
         } catch (e: Exception) {
            promise.reject("REVOKE_ERROR", e.message, e)
         }
       }
    }

    AsyncFunction("verifyToken") { config: Map<String, Any>, promise: Promise ->
       val clientId = config["clientId"] as? String ?: run { promise.reject("CONFIG_ERROR", "clientId required", null); return@AsyncFunction }
       val idToken = config["idToken"] as? String ?: run { promise.reject("INVALID_ARGS", "idToken required", null); return@AsyncFunction }

       val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return@AsyncFunction

       module.scope.launch {
         try {
            val client = CasClient(clientId, environment)
            val claims = client.verifyToken(idToken, audience = clientId)
            promise.resolve(normalizeClaims(claims))
         } catch (e: Exception) {
            promise.reject("VERIFY_ERROR", e.message, e)
         }
       }
    }

    // Handle Activity Result (For Native App Flow)
    OnActivityResult { _, payload ->
       if (payload.requestCode != AUTH_REQUEST_CODE) return@OnActivityResult
       val promise = module.currentPromise ?: return@OnActivityResult
       if (payload.resultCode == Activity.RESULT_CANCELED) {
           promise.resolve(mapOf(
               "error" to "cancelled",
               "error_description" to "User cancelled authentication"
           ))
           module.clearAuthState()
           return@OnActivityResult
       }
       if (payload.resultCode == Activity.RESULT_OK) {
           val data = payload.data
           if (data == null) {
               promise.resolve(mapOf(
                   "error" to "platform_error",
                   "error_description" to "No result data returned"
               ))
               module.clearAuthState()
               return@OnActivityResult
           }
           module.handleAuthIntent(data)
           return@OnActivityResult
       }
       promise.resolve(mapOf(
           "error" to "platform_error",
           "error_description" to "Unexpected result code: ${payload.resultCode}"
       ))
       module.clearAuthState()
    }
  }
  
  private fun isValidRedirectUri(configuredRedirectUri: String, incoming: Uri): Boolean {
    val configured = Uri.parse(configuredRedirectUri)
    if (configured.scheme != "https") return false
    val host = configured.host ?: return false
    if (host.isBlank()) return false
    if (incoming.scheme != "https") return false
    val incomingHost = incoming.host ?: return false
    if (incomingHost.isBlank()) return false
    if (incomingHost != host) return false

    val configuredPort = configured.port
    val incomingPort = incoming.port
    if (configuredPort != -1 || incomingPort != -1) {
      if (configuredPort != incomingPort) return false
    }

    return true
  }

  private fun handleAuthIntent(intent: Intent) {
       val data = intent.data
       val redirectUri = currentRedirectUri
       val promise = currentPromise
       if (data != null && promise != null && redirectUri != null) {
          if (!isValidRedirectUri(redirectUri, data)) {
             promise.resolve(mapOf(
                "error" to "invalid_redirect",
                "error_description" to "Redirect URI does not match configured host"
             ))
             clearAuthState()
             return
          }

          val code = data.getQueryParameter("code")
          val state = data.getQueryParameter("state")
          val error = data.getQueryParameter("error")
          val errorDescription = data.getQueryParameter("error_description")

          if (error != null) {
             val canonicalError = when (error) {
               "access_denied", "user_cancelled", "login_required", "consent_denied" -> "cancelled"
               else -> error
             }
             promise.resolve(mapOf(
                "error" to canonicalError,
                "error_description" to (errorDescription ?: error)
             ))
             clearAuthState()
             return
          }

          // Fail closed: the returned state must be present and match what we sent.
          val expectedState = currentState
          if (expectedState.isNullOrBlank() || state.isNullOrBlank() || state != expectedState) {
             promise.resolve(mapOf(
                "error" to "state_mismatch",
                "error_description" to "State missing or does not match the request (possible CSRF / response injection)"
             ))
             clearAuthState()
             return
          }

          if (code != null) {
             if (currentCodeVerifier == null) {
                promise.resolve(mapOf(
                   "code" to code,
                   "state" to state
                ))
                clearAuthState()
             } else {
                // Capture state into locals BEFORE the coroutine: a timeout/cancel can
                // clear the fields concurrently, and `!!` on them would crash (NPE).
                val client = currentCasClient
                val verifier = currentCodeVerifier
                val rUri = currentRedirectUri
                val pendingPromise = currentPromise
                val expectedNonce = currentNonce
                val cid = currentClientId
                val env = currentEnvironment
                if (client == null || verifier == null || rUri == null || pendingPromise == null) {
                   promise.resolve(mapOf(
                      "error" to "platform_error",
                      "error_description" to "Authentication state was cleared before token exchange"
                   ))
                   clearAuthState()
                   return
                }
                scope.launch {
                   try {
                     val tokens = client.exchangeCodeForTokens(code, verifier, rUri)
                     // OIDC: validate the id_token (signature, iss, aud, exp) and bind it to our
                     // nonce before trusting the result. Fail closed on any mismatch.
                     val idToken = tokens.idToken
                        ?: throw IllegalStateException("Token response did not include an id_token")
                     val claims = client.verifyToken(
                        idToken,
                        issuer = env?.authServerUrl,
                        audience = cid
                     )
                     val returnedNonce = claims["nonce"] as? String
                     if (returnedNonce.isNullOrBlank() || returnedNonce != expectedNonce) {
                        throw IllegalStateException("ID token nonce mismatch (possible token replay)")
                     }
                     pendingPromise.resolve(mapOf(
                        "accessToken" to tokens.accessToken,
                        "idToken" to tokens.idToken,
                        "refreshToken" to tokens.refreshToken,
                           "expiresIn" to tokens.expiresIn,
                           "tokenType" to tokens.tokenType,
                           "scope" to tokens.scope
                        ))
                      } catch (e: Exception) {
                        pendingPromise.reject("EXCHANGE_ERROR", e.message, e)
                      } finally {
                        clearAuthState()
                      }
                   }
                }
          } else {
             promise.resolve(mapOf(
                "error" to "no_code",
                "error_description" to "No authorization code received"
             ))
             clearAuthState()
          }
       }
  }

  private fun clearAuthState() {
    cancelAuthTimeout()
    currentPromise = null
    currentCodeVerifier = null
    currentRedirectUri = null
    currentCasClient = null
    currentState = null
    currentNonce = null
    currentClientId = null
    currentEnvironment = null
  }

  private fun scheduleAuthTimeout(timeoutSeconds: Double) {
    cancelAuthTimeout()
    val timeoutMillis = (timeoutSeconds * 1000.0).toLong()
    if (timeoutMillis <= 0L) return
    val scheduledPromise = currentPromise ?: return
    currentAuthTimeoutJob = scope.launch {
      delay(timeoutMillis)
      withContext(Dispatchers.Main) {
        if (currentPromise === scheduledPromise) {
          resolveAuthError(scheduledPromise, "timeout", "Authentication timed out")
          clearAuthState()
        }
      }
    }
  }

  private fun cancelAuthTimeout() {
    currentAuthTimeoutJob?.cancel()
    currentAuthTimeoutJob = null
  }

  private fun resolveAuthError(promise: Promise, error: String, description: String) {
    promise.resolve(
      mapOf(
        "error" to error,
        "error_description" to description
      )
    )
  }

  private fun normalizeClaims(claims: Map<String, Any?>): Map<String, Any?> {
    return claims.mapValues { normalizeClaimValue(it.value) }
  }

  private fun normalizeClaimValue(value: Any?): Any? {
    return when (value) {
      is Date -> value.time / 1000
      is Map<*, *> -> value.entries.associate { entry ->
        entry.key.toString() to normalizeClaimValue(entry.value)
      }
      is List<*> -> value.map { item -> normalizeClaimValue(item) }
      is Array<*> -> value.map { item -> normalizeClaimValue(item) }
      else -> value
    }
  }

  private fun parseEnvironment(value: Any?): KrdpassEnvironment? {
    if (value == null) return KrdpassEnvironment.Production
    val envStr = (value as? String)?.trim()?.uppercase(Locale.ROOT) ?: return null
    return when (envStr) {
      "PRODUCTION" -> KrdpassEnvironment.Production
      "DEVELOPMENT", "DEV" -> KrdpassEnvironment.Development
      else -> null
    }
  }

  private fun parseEnvironmentOrReject(value: Any?, promise: Promise): KrdpassEnvironment? {
    val parsed = parseEnvironment(value)
    if (parsed == null) {
      promise.reject("CONFIG_ERROR", "environment must be PRODUCTION or DEVELOPMENT", null)
    }
    return parsed
  }

  /**
   * Verifies the KRDPass provider app is installed with the expected signing certificate.
   * Returns an error description on failure, or null if all checks pass.
   */
  private fun checkProviderInstalled(activity: Activity, environment: KrdpassEnvironment): String? {
    val pm = activity.packageManager
    val pkg = environment.providerPackage

    val expected = environment.providerSigningCertsSha256
    if (expected.isEmpty()) {
      // Production must always pin; an empty set is a build misconfiguration, not a valid skip.
      if (environment == KrdpassEnvironment.Production) {
        return "KRDPass installation could not be verified (provider signing pin is not configured)."
      }
      // Development: pinning is optional so emulators / locally-built debug APKs can launch.
      return null
    }

    val actualCerts: Set<String> = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
        val signingInfo = info.signingInfo
          ?: return "KRDPass is not installed. Download it from the Play Store."
        val sigs = if (signingInfo.hasMultipleSigners()) signingInfo.apkContentsSigners.toList()
                   else signingInfo.signingCertificateHistory.toList()
        sigs.mapTo(mutableSetOf()) { certSha256Hex(it.toByteArray()) }
      } else {
        @Suppress("DEPRECATION")
        val info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES)
        @Suppress("DEPRECATION")
        (info.signatures ?: emptyArray()).mapTo(mutableSetOf()) { certSha256Hex(it.toByteArray()) }
      }
    } catch (_: PackageManager.NameNotFoundException) {
      return "KRDPass is not installed. Download it from the Play Store."
    }

    if (actualCerts.intersect(expected).isEmpty()) {
      return "KRDPass installation could not be verified. Please reinstall from the Play Store."
    }

    return null
  }

  private fun certSha256Hex(der: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256")
    return digest.digest(der).joinToString(":") { b -> "%02X".format(b) }
  }
}

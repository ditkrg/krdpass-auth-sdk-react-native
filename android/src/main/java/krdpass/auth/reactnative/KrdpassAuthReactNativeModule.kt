package krdpass.auth.reactnative

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import krd.pass.auth.AuthResult
import krd.pass.auth.CasClient
import krd.pass.auth.KrdpassAuth
import krd.pass.auth.KrdpassConfig
import krd.pass.auth.KrdpassEnvironment
import krd.pass.auth.KrdpassError
import krd.pass.auth.KrdpassTokenResult
import krd.pass.auth.PkceGenerator
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicReference

/**
 * React Native (Expo) bridge for KRDPASS auth.
 *
 * The launch/result security flow (provider cert-pin, CSRF/redirect validation, error
 * canonicalization, PKCE + id_token nonce binding) is owned by the core SDK's stateless
 * [KrdpassAuth.startAuthentication]/[KrdpassAuth.handleAuthorizationResult]/[KrdpassAuth.startSignIn]/
 * [KrdpassAuth.finishSignIn]. This bridge only owns the Expo launch plumbing (legacy
 * `startActivityForResult` + `OnActivityResult`, which RN modules cannot replace with AndroidX
 * `registerForActivityResult`) and the JS marshalling. Token ops call [CasClient] directly since they
 * have no launcher dependency.
 */
class KrdpassAuthReactNativeModule : Module() {
  private val scope = CoroutineScope(Dispatchers.IO)

  /**
   * The single in-flight auth flow. The core path is stateless, so the host owns this state,
   * in an [AtomicReference] that is DETACHED (compareAndSet/getAndSet to null) at every terminal
   * path, so cancelAuthentication (Expo module queue), the timeout (IO scope to Main) and
   * OnActivityResult (main thread) can race yet settle the promise exactly once. Same design as
   * the core SDK's InFlight slot.
   */
  private class Flight(
    val promise: Promise,
    val config: KrdpassConfig,
    val expectedState: String?, // authenticate() mode
    val isSignIn: Boolean,
  ) {
    @Volatile var signInPending: KrdpassAuth.SignInPending? = null // set once PAR completes
    @Volatile var timeoutJob: Job? = null
  }

  private val flight = AtomicReference<Flight?>(null)

  /** Atomically detach [f]; true exactly once per flight. Cancels its timeout on success. */
  private fun detach(f: Flight): Boolean =
    flight.compareAndSet(f, null).also { if (it) f.timeoutJob?.cancel() }

  companion object {
    private const val AUTH_REQUEST_CODE = 9988
  }

  override fun definition() = ModuleDefinition {
    Name("KrdpassAuthReactNative")

    val module = this@KrdpassAuthReactNativeModule

    AsyncFunction("signIn") { config: Map<String, Any>, promise: Promise ->
      val clientId = config["clientId"] as? String ?: run {
        promise.reject("CONFIG_ERROR", "clientId is required", null); return@AsyncFunction
      }
      val redirectUri = config["redirectUri"] as? String ?: run {
        promise.reject("CONFIG_ERROR", "redirectUri is required", null); return@AsyncFunction
      }
      val scopes = (config["scopes"] as? String ?: "openid profile").split(" ").filter { it.isNotBlank() }
      val timeoutSeconds = (config["timeout"] as? Number)?.toDouble()?.takeIf { it > 0 && it.isFinite() } ?: 300.0
      val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return@AsyncFunction

      val krdConfig = KrdpassConfig(clientId, redirectUri, environment)
      val f = Flight(promise, krdConfig, expectedState = null, isSignIn = true)
      if (!module.flight.compareAndSet(null, f)) {
        promise.reject("busy", AuthResult.Busy.message ?: "", null)
        return@AsyncFunction
      }

      module.scope.launch {
        try {
          val activity = withContext(Dispatchers.Main) { module.appContext.currentActivity }
          if (activity == null) {
            withContext(Dispatchers.Main) {
              if (module.detach(f)) promise.reject("NO_ACTIVITY", "Current activity is null", null)
            }
            return@launch
          }
          // PKCE + PAR + cert-pin + intent build all happen in the core (shared with the Android SDK).
          val (launch, pending) = KrdpassAuth.startSignIn(activity, krdConfig, scopes)
          withContext(Dispatchers.Main) {
            when (launch) {
              is KrdpassAuth.AuthLaunch.Failure -> {
                if (module.detach(f)) {
                  promise.reject(module.resultErrorCode(launch.error), launch.error.message ?: "", null)
                }
              }
              is KrdpassAuth.AuthLaunch.Ready -> {
                // A cancel/timeout during the PAR window already settled the promise, so don't launch.
                if (module.flight.get() !== f) return@withContext
                f.signInPending = pending
                try {
                  activity.startActivityForResult(launch.intent, AUTH_REQUEST_CODE)
                  module.scheduleAuthTimeout(f, timeoutSeconds)
                } catch (e: Exception) {
                  if (module.detach(f)) {
                    promise.reject("launch_failed", e.message ?: "Failed to open KRDPASS", e)
                  }
                }
              }
            }
          }
        } catch (e: Exception) {
          withContext(Dispatchers.Main) {
            if (module.detach(f)) promise.reject("network_error", e.message, e)
          }
        }
      }
    }

    AsyncFunction("generatePkcePair") {
      val pkce = PkceGenerator.generate()
      mapOf("codeVerifier" to pkce.codeVerifier, "codeChallenge" to pkce.codeChallenge)
    }

    AsyncFunction("authenticate") { config: Map<String, Any>, promise: Promise ->
      val clientId = config["clientId"] as? String
      if (clientId.isNullOrBlank()) { module.resolveAuthError(promise, "platform_error", "clientId is required"); return@AsyncFunction }
      val redirectUri = config["redirectUri"] as? String
      if (redirectUri.isNullOrBlank()) { module.resolveAuthError(promise, "platform_error", "redirectUri is required"); return@AsyncFunction }
      val requestUri = config["requestUri"] as? String
      if (requestUri.isNullOrBlank()) { module.resolveAuthError(promise, "platform_error", "requestUri is required"); return@AsyncFunction }
      val state = config["state"] as? String
      val timeoutSeconds = (config["timeout"] as? Number)?.toDouble() ?: 300.0
      if (timeoutSeconds <= 0 || !timeoutSeconds.isFinite()) {
        module.resolveAuthError(promise, "platform_error", "timeout must be a positive number of seconds")
        return@AsyncFunction
      }
      val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return@AsyncFunction

      val krdConfig = KrdpassConfig(clientId, redirectUri, environment)
      val f = Flight(promise, krdConfig, expectedState = state, isSignIn = false)
      if (!module.flight.compareAndSet(null, f)) {
        promise.resolve(module.authResultToMap(AuthResult.Busy))
        return@AsyncFunction
      }

      module.scope.launch {
        withContext(Dispatchers.Main) {
          val activity = module.appContext.currentActivity
          if (activity == null) {
            if (module.detach(f)) module.resolveAuthError(promise, "platform_error", "Current activity is null")
            return@withContext
          }
          // startAuthentication owns arg/state validation + cert-pin + intent build (shared with the SDK).
          when (val launch = KrdpassAuth.startAuthentication(activity, krdConfig, requestUri, state ?: "")) {
            is KrdpassAuth.AuthLaunch.Failure -> {
              if (module.detach(f)) promise.resolve(module.authResultToMap(launch.error))
            }
            is KrdpassAuth.AuthLaunch.Ready -> {
              // A cancel/timeout during the IO->Main dispatch hop already settled the promise,
              // so don't launch. (Same guard as signIn()'s Ready branch, below.)
              if (module.flight.get() !== f) return@withContext
              try {
                activity.startActivityForResult(launch.intent, AUTH_REQUEST_CODE)
                module.scheduleAuthTimeout(f, timeoutSeconds)
              } catch (e: Exception) {
                if (module.detach(f)) {
                  module.resolveAuthError(promise, "launch_failed", e.message ?: "Failed to open KRDPASS")
                }
              }
            }
          }
        }
      }
    }

    AsyncFunction("cancelAuthentication") { config: Map<String, Any>? ->
      val timeout = (config?.get("timeout") as? Boolean) ?: false
      // getAndSet detaches the whole flight in one op, so a racing result/timeout sees null.
      val f = module.flight.getAndSet(null)
      if (f != null) {
        f.timeoutJob?.cancel()
        val terminal: AuthResult = if (timeout) AuthResult.Timeout else AuthResult.Cancelled
        // signIn() rejects (throws to JS); authenticate() resolves an error map.
        if (f.isSignIn) {
          f.promise.reject(module.resultErrorCode(terminal), terminal.message ?: "", null)
        } else {
          f.promise.resolve(module.authResultToMap(terminal))
        }
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
            promise.resolve(module.tokensToMap(result))
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
       val clockSkewSeconds = (config["clockSkew"] as? Number)?.toLong() ?: 60L

       val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return@AsyncFunction

       module.scope.launch {
         try {
            val client = CasClient(clientId, environment)
            val claims = client.verifyToken(idToken, audience = clientId, clockSkewSeconds = clockSkewSeconds)
            promise.resolve(module.normalizeClaims(claims))
         } catch (e: Exception) {
            promise.reject("VERIFY_ERROR", e.message, e)
         }
       }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != AUTH_REQUEST_CODE) return@OnActivityResult
      // Atomic detach = single delivery: a racing timeout/cancel/duplicate dispatch sees null.
      val f = module.flight.getAndSet(null) ?: return@OnActivityResult
      f.timeoutJob?.cancel()

      val pending = f.signInPending
      if (pending != null) {
        // signIn(): exchange + id_token validation in the core, off the main thread.
        module.scope.launch {
          try {
            val tokens = KrdpassAuth.finishSignIn(payload.resultCode, payload.data, f.config, pending)
            withContext(Dispatchers.Main) { f.promise.resolve(module.tokensToMap(tokens)) }
          } catch (e: Exception) {
            withContext(Dispatchers.Main) { f.promise.reject(module.krdpassErrorCode(e), e.message, e) }
          }
        }
      } else {
        // authenticate(): pure result policy (CSRF/redirect/canonicalization) in the core.
        f.promise.resolve(module.authResultToMap(
          KrdpassAuth.handleAuthorizationResult(payload.resultCode, payload.data, f.config, f.expectedState ?: "")))
      }
    }
  }

  // --- In-flight state -----------------------------------------------------------------------

  private fun scheduleAuthTimeout(f: Flight, timeoutSeconds: Double) {
    val timeoutMillis = (timeoutSeconds * 1000.0).toLong()
    if (timeoutMillis <= 0L) return
    f.timeoutJob = scope.launch {
      delay(timeoutMillis)
      withContext(Dispatchers.Main) {
        // detach() is the single-settle gate; a completed/cancelled flight makes this a no-op.
        if (detach(f)) {
          if (f.isSignIn) f.promise.reject("timeout", AuthResult.Timeout.message ?: "", null)
          else f.promise.resolve(authResultToMap(AuthResult.Timeout))
        }
      }
    }
  }

  // --- JS marshalling ------------------------------------------------------------------------

  private fun resolveAuthError(promise: Promise, error: String, description: String) {
    promise.resolve(mapOf("error" to error, "error_description" to description))
  }

  /** Map a core [AuthResult] to the JS `authenticate()` result shape ({code,state} | {error,...}). */
  private fun authResultToMap(result: AuthResult): Map<String, Any?> = when (result) {
    is AuthResult.Success -> mapOf("code" to result.code, "state" to result.state)
    else -> mapOf("error" to resultErrorCode(result), "error_description" to (result.message ?: ""))
  }

  private fun resultErrorCode(result: AuthResult): String = when (result) {
    is AuthResult.Cancelled -> "cancelled"
    is AuthResult.Timeout -> "timeout"
    is AuthResult.Busy -> "busy"
    is AuthResult.Error -> result.error
    is AuthResult.Success -> ""
  }

  private fun krdpassErrorCode(e: Throwable): String = when (e) {
    is KrdpassError.UserCancelled -> "cancelled"
    is KrdpassError.Timeout -> "timeout"
    is KrdpassError.Busy -> "busy"
    is KrdpassError.NetworkError -> "network_error"
    // Surface the structured wire code (state_mismatch/no_code/nonce_mismatch/CAS OAuth codes)
    // like the iOS bridge does, instead of collapsing everything to authentication_failed.
    is KrdpassError.AuthenticationFailed -> e.code ?: "authentication_failed"
    else -> "authentication_failed"
  }

  private fun tokensToMap(tokens: KrdpassTokenResult): Map<String, Any?> = mapOf(
    "accessToken" to tokens.accessToken,
    "idToken" to tokens.idToken,
    "refreshToken" to tokens.refreshToken,
    "expiresIn" to tokens.expiresIn,
    "tokenType" to tokens.tokenType,
    "scope" to tokens.scope,
  )

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

  private fun parseEnvironmentOrReject(value: Any?, promise: Promise): KrdpassEnvironment? {
    val parsed = if (value == null) {
      KrdpassEnvironment.Production
    } else {
      when ((value as? String)?.trim()?.uppercase(Locale.ROOT)) {
        "PRODUCTION" -> KrdpassEnvironment.Production
        "DEVELOPMENT", "DEV" -> KrdpassEnvironment.Development
        else -> null
      }
    }
    if (parsed == null) {
      promise.reject("CONFIG_ERROR", "environment must be PRODUCTION or DEVELOPMENT", null)
    }
    return parsed
  }
}

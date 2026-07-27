package krdpass.auth.reactnative

import android.app.Activity
import android.content.Intent
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import krd.pass.auth.AuthResult
import krd.pass.auth.KrdpassAuth
import krd.pass.auth.KrdpassConfig
import krd.pass.auth.KrdpassEnvironment
import krd.pass.auth.KrdpassError
import krd.pass.auth.KrdpassTokenResult
import krd.pass.auth.PkceGenerator
import org.json.JSONArray
import org.json.JSONObject
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicReference

/**
 * React Native bridge for KRDPASS authentication.
 *
 * An ordinary autolinked module with no Expo Modules runtime dependency, so it works in Expo
 * development/EAS builds and bare applications alike. The core SDK owns the security policy;
 * this module owns only React Native activity and promise plumbing.
 *
 * Every promise rejection code here is a lowercase wire code shared with the Android, iOS and
 * Flutter SDKs, and is the public contract the JS layer turns into KrdpassAuthError.code. Do
 * not invent a new one, and never an UPPERCASE one.
 */
@ReactModule(name = KrdpassAuthReactNativeModule.NAME)
@DoNotStrip
class KrdpassAuthReactNativeModule(
  private val reactContext: ReactApplicationContext,
) : NativeKrdpassAuthReactNativeSpec(reactContext), ActivityEventListener {
  private val scopeJob = SupervisorJob()
  private val scope = CoroutineScope(scopeJob + Dispatchers.IO)

  private class Flight(
    val promise: Promise,
    val config: KrdpassConfig,
    val expectedState: String?,
    val isSignIn: Boolean,
  ) {
    @Volatile var signInPending: KrdpassAuth.SignInPending? = null
    @Volatile var timeoutJob: Job? = null
  }

  private val flight = AtomicReference<Flight?>(null)

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun invalidate() {
    flight.getAndSet(null)?.timeoutJob?.cancel()
    scopeJob.cancel()
    reactContext.removeActivityEventListener(this)
    super.invalidate()
  }

  @DoNotStrip
  override fun signIn(configValue: ReadableMap, promise: Promise) {
    val config = configValue.toHashMap()
    val clientId = config["clientId"] as? String ?: run {
      promise.reject("invalid_request", "clientId is required")
      return
    }
    val redirectUri = config["redirectUri"] as? String ?: run {
      promise.reject("invalid_request", "redirectUri is required")
      return
    }
    val scopes = (config["scopes"] as? String ?: "openid profile")
      .split(" ")
      .filter { it.isNotBlank() }
    val timeoutSeconds = (config["timeout"] as? Number)?.toDouble()
      ?.takeIf { it > 0 && it.isFinite() } ?: 300.0
    val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return

    val f = Flight(
      promise = promise,
      config = KrdpassConfig(clientId, redirectUri, environment),
      expectedState = null,
      isSignIn = true,
    )
    if (!flight.compareAndSet(null, f)) {
      promise.reject("busy", AuthResult.Busy.message ?: "")
      return
    }

    scope.launch {
      try {
        val activity = withContext(Dispatchers.Main) { reactContext.currentActivity }
        if (activity == null) {
          withContext(Dispatchers.Main) {
            if (detach(f)) promise.reject("launch_failed", "Current activity is null")
          }
          return@launch
        }
        val (launch, pending) = KrdpassAuth.startSignIn(activity, f.config, scopes)
        withContext(Dispatchers.Main) {
          when (launch) {
            is KrdpassAuth.AuthLaunch.Failure -> {
              if (detach(f)) promise.reject(resultErrorCode(launch.error), launch.error.message ?: "")
            }
            is KrdpassAuth.AuthLaunch.Ready -> {
              if (flight.get() !== f) return@withContext
              f.signInPending = pending
              try {
                launchForAuthentication(activity, launch)
                scheduleAuthTimeout(f, timeoutSeconds)
              } catch (e: Exception) {
                if (detach(f)) promise.reject("launch_failed", e.message ?: "Failed to open KRDPASS", e)
              }
            }
          }
        }
      } catch (e: Exception) {
        withContext(Dispatchers.Main) {
          if (detach(f)) promise.reject("network_error", e.message, e)
        }
      }
    }
  }

  @DoNotStrip
  override fun generatePkcePair(promise: Promise) {
    try {
      val pkce = PkceGenerator.generate()
      promise.resolve(nativeMap(mapOf("codeVerifier" to pkce.codeVerifier, "codeChallenge" to pkce.codeChallenge)))
    } catch (e: Exception) {
      promise.reject("pkce_generation_failed", e.message, e)
    }
  }

  @DoNotStrip
  override fun authenticate(configValue: ReadableMap, promise: Promise) {
    val config = configValue.toHashMap()
    val clientId = config["clientId"] as? String
    if (clientId.isNullOrBlank()) {
      resolveAuthError(promise, "platform_error", "clientId is required")
      return
    }
    val redirectUri = config["redirectUri"] as? String
    if (redirectUri.isNullOrBlank()) {
      resolveAuthError(promise, "platform_error", "redirectUri is required")
      return
    }
    val requestUri = config["requestUri"] as? String
    if (requestUri.isNullOrBlank()) {
      resolveAuthError(promise, "platform_error", "requestUri is required")
      return
    }
    val state = config["state"] as? String
    val timeoutSeconds = (config["timeout"] as? Number)?.toDouble() ?: 300.0
    if (timeoutSeconds <= 0 || !timeoutSeconds.isFinite()) {
      resolveAuthError(promise, "platform_error", "timeout must be a positive number of seconds")
      return
    }
    val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return

    val f = Flight(
      promise = promise,
      config = KrdpassConfig(clientId, redirectUri, environment),
      expectedState = state,
      isSignIn = false,
    )
    if (!flight.compareAndSet(null, f)) {
      promise.resolve(authResultToMap(AuthResult.Busy))
      return
    }

    scope.launch {
      withContext(Dispatchers.Main) {
        val activity = reactContext.currentActivity
        if (activity == null) {
          if (detach(f)) resolveAuthError(promise, "platform_error", "Current activity is null")
          return@withContext
        }
        when (val launch = KrdpassAuth.startAuthentication(activity, f.config, requestUri, state ?: "")) {
          is KrdpassAuth.AuthLaunch.Failure -> {
            if (detach(f)) promise.resolve(authResultToMap(launch.error))
          }
          is KrdpassAuth.AuthLaunch.Ready -> {
            if (flight.get() !== f) return@withContext
            try {
              launchForAuthentication(activity, launch)
              scheduleAuthTimeout(f, timeoutSeconds)
            } catch (e: Exception) {
              if (detach(f)) resolveAuthError(promise, "launch_failed", e.message ?: "Failed to open KRDPASS")
            }
          }
        }
      }
    }
  }

  @DoNotStrip
  override fun cancelAuthentication(config: ReadableMap, promise: Promise) {
    val timeout = config.getBoolean("timeout")
    val f = flight.getAndSet(null)
    if (f == null) {
      promise.resolve(false)
      return
    }
    f.timeoutJob?.cancel()
    val terminal: AuthResult = if (timeout) AuthResult.Timeout else AuthResult.Cancelled
    if (f.isSignIn) f.promise.reject(resultErrorCode(terminal), terminal.message ?: "")
    else f.promise.resolve(authResultToMap(terminal))
    promise.resolve(true)
  }

  @DoNotStrip
  override fun getUserInfo(configValue: ReadableMap, promise: Promise) {
    val config = configValue.toHashMap()
    val clientId = config["clientId"] as? String
    val accessToken = config["accessToken"] as? String
    if (clientId.isNullOrBlank()) {
      promise.reject("invalid_request", "clientId is required in config")
      return
    }
    if (accessToken.isNullOrBlank()) {
      promise.reject("invalid_request", "accessToken is required in config")
      return
    }
    val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return
    scope.launch {
      try {
        promise.resolve(nativeMap(KrdpassAuth.getUserInfo(clientId, environment, accessToken).raw))
      } catch (e: Exception) {
        promise.reject("user_info_failed", e.message, e)
      }
    }
  }

  @DoNotStrip
  override fun refreshTokens(configValue: ReadableMap, promise: Promise) {
    val config = configValue.toHashMap()
    val clientId = config["clientId"] as? String ?: run {
      promise.reject("invalid_request", "clientId required"); return
    }
    val refreshToken = config["refreshToken"] as? String ?: run {
      promise.reject("invalid_request", "refreshToken required"); return
    }
    val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return
    scope.launch {
      try {
        promise.resolve(tokensToMap(
          KrdpassAuth.refreshTokens(clientId, environment, refreshToken, config["scope"] as? String)))
      } catch (e: Exception) {
        promise.reject("refresh_failed", e.message, e)
      }
    }
  }

  @DoNotStrip
  override fun revokeToken(configValue: ReadableMap, promise: Promise) {
    val config = configValue.toHashMap()
    val clientId = config["clientId"] as? String ?: run {
      promise.reject("invalid_request", "clientId required"); return
    }
    val token = config["token"] as? String ?: run {
      promise.reject("invalid_request", "token required"); return
    }
    val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return
    scope.launch {
      try {
        KrdpassAuth.revokeToken(clientId, environment, token, config["tokenTypeHint"] as? String)
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("revoke_failed", e.message, e)
      }
    }
  }

  @DoNotStrip
  override fun verifyToken(configValue: ReadableMap, promise: Promise) {
    val config = configValue.toHashMap()
    val clientId = config["clientId"] as? String ?: run {
      promise.reject("invalid_request", "clientId required"); return
    }
    val idToken = config["idToken"] as? String ?: run {
      promise.reject("invalid_request", "idToken required"); return
    }
    val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return
    val clockSkewSeconds = (config["clockSkew"] as? Number)?.toLong() ?: 60L
    scope.launch {
      try {
        val claims = KrdpassAuth.verifyToken(clientId, environment, idToken, clockSkewSeconds)
        promise.resolve(nativeMap(claims))
      } catch (e: Exception) {
        promise.reject(verifyErrorCode(e), e.message, e)
      }
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != AUTH_REQUEST_CODE) return
    val f = flight.getAndSet(null) ?: return
    f.timeoutJob?.cancel()
    val pending = f.signInPending
    if (pending != null) {
      scope.launch {
        try {
          val tokens = KrdpassAuth.finishSignIn(resultCode, data, f.config, pending)
          withContext(Dispatchers.Main) { f.promise.resolve(tokensToMap(tokens)) }
        } catch (e: Exception) {
          withContext(Dispatchers.Main) { f.promise.reject(krdpassErrorCode(e), e.message, e) }
        }
      }
    } else {
      f.promise.resolve(authResultToMap(KrdpassAuth.handleAuthorizationResult(resultCode, data, f.config, f.expectedState ?: "")))
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  /** Android completes browser authentication through [onActivityResult], not deep-link dispatch. */
  @DoNotStrip
  override fun handleURL(url: String) = Unit

  /** Launches a core-prepared activity-result transaction without replacing its options. */
  private fun launchForAuthentication(activity: Activity, launch: KrdpassAuth.AuthLaunch.Ready) {
    activity.startActivityForResult(
      launch.intent,
      AUTH_REQUEST_CODE,
      launch.activityOptions,
    )
  }

  private fun detach(f: Flight): Boolean =
    flight.compareAndSet(f, null).also { if (it) f.timeoutJob?.cancel() }

  private fun scheduleAuthTimeout(f: Flight, timeoutSeconds: Double) {
    val timeoutMillis = (timeoutSeconds * 1000.0).toLong()
    if (timeoutMillis <= 0L) return
    f.timeoutJob = scope.launch {
      delay(timeoutMillis)
      withContext(Dispatchers.Main) {
        if (detach(f)) {
          if (f.isSignIn) f.promise.reject("timeout", AuthResult.Timeout.message ?: "")
          else f.promise.resolve(authResultToMap(AuthResult.Timeout))
        }
      }
    }
  }

  private fun resolveAuthError(promise: Promise, error: String, description: String) {
    promise.resolve(nativeMap(mapOf("error" to error, "error_description" to description)))
  }

  private fun authResultToMap(result: AuthResult) = nativeMap(
    when (result) {
      is AuthResult.Success -> mapOf("code" to result.code, "state" to result.state)
      else -> mapOf("error" to resultErrorCode(result), "error_description" to (result.message ?: ""))
    },
  )

  private fun resultErrorCode(result: AuthResult): String = when (result) {
    is AuthResult.Cancelled -> "cancelled"
    is AuthResult.Timeout -> "timeout"
    is AuthResult.Busy -> "busy"
    is AuthResult.Error -> result.error
    is AuthResult.Success -> ""
  }

  /**
   * Forward the core's own verifyToken classification (`invalid_id_token` for signature/claims,
   * `network_error` for an unfetchable JWKS) and fall back to `verification_failed` only when it
   * has none. Flattening everything to `verification_failed` hides the retryable case.
   *
   * Separate from [krdpassErrorCode]: that one falls back to `authentication_failed`, the signIn
   * fallback, not this call's.
   */
  private fun verifyErrorCode(e: Throwable): String = when (e) {
    is KrdpassError.NetworkError -> "network_error"
    is KrdpassError.AuthenticationFailed -> e.code ?: "verification_failed"
    else -> "verification_failed"
  }

  private fun krdpassErrorCode(e: Throwable): String = when (e) {
    is KrdpassError.UserCancelled -> "cancelled"
    is KrdpassError.Timeout -> "timeout"
    is KrdpassError.Busy -> "busy"
    is KrdpassError.NetworkError -> "network_error"
    is KrdpassError.AuthenticationFailed -> e.code ?: "authentication_failed"
    else -> "authentication_failed"
  }

  private fun tokensToMap(tokens: KrdpassTokenResult) = nativeMap(
    mapOf(
      "accessToken" to tokens.accessToken,
      "idToken" to tokens.idToken,
      "refreshToken" to tokens.refreshToken,
      "expiresIn" to tokens.expiresIn,
      "tokenType" to tokens.tokenType,
      "scope" to tokens.scope,
    ),
  )

  private fun nativeMap(values: Map<String, Any?>) =
    Arguments.makeNativeMap(values.mapValues { normalizeBridgeValue(it.value) })

  private fun normalizeBridgeValue(value: Any?): Any? {
    if (value == null || value === JSONObject.NULL) return null
    return when (value) {
      is Date -> value.time / 1000
      is JSONObject -> buildMap {
        val keys = value.keys()
        while (keys.hasNext()) {
          val key = keys.next()
          put(key, normalizeBridgeValue(value.opt(key)))
        }
      }
      is JSONArray -> List(value.length()) { normalizeBridgeValue(value.opt(it)) }
      is Map<*, *> -> value.entries.associate { it.key.toString() to normalizeBridgeValue(it.value) }
      is Iterable<*> -> value.map { normalizeBridgeValue(it) }
      is Array<*> -> value.map { normalizeBridgeValue(it) }
      else -> value
    }
  }

  private fun parseEnvironmentOrReject(value: Any?, promise: Promise): KrdpassEnvironment? {
    val parsed = if (value == null) KrdpassEnvironment.Production else when ((value as? String)?.trim()?.uppercase(Locale.ROOT)) {
      "PRODUCTION" -> KrdpassEnvironment.Production
      "DEVELOPMENT", "DEV" -> KrdpassEnvironment.Development
      else -> null
    }
    if (parsed == null) promise.reject("invalid_request", "environment must be PRODUCTION or DEVELOPMENT")
    return parsed
  }

  companion object {
    const val NAME = "KrdpassAuthReactNative"
    const val AUTH_REQUEST_CODE = 9988
  }
}

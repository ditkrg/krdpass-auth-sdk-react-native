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
import kotlinx.coroutines.CancellationException
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
import krd.pass.auth.KrdpassTokenResult
import krd.pass.auth.PkceGenerator
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * React Native bridge for KRDPASS authentication. The core SDK owns the security policy; this
 * module owns only React Native activity and promise plumbing. Every promise rejection code is
 * a lowercase wire code shared with the Android, iOS and Flutter SDKs: do not invent a new one,
 * and never an UPPERCASE one.
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
    // Settle before cancelling: teardown otherwise drops the in-flight promise and JS waits
    // on it forever.
    flight.getAndSet(null)?.let {
      KrdpassAuth.cancelPendingAuthentication()
      settleTerminal(it, timeout = false)
    }
    scopeJob.cancel()
    reactContext.removeActivityEventListener(this)
    super.invalidate()
  }

  @DoNotStrip
  override fun signIn(configValue: ReadableMap, promise: Promise) {
    val args = parseSignInArgs(configValue.toHashMap(), promise) ?: return
    val f = Flight(
      promise = promise,
      config = args.config,
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
        val (launch, pending) = KrdpassAuth.startSignIn(activity, f.config, args.scopes)
        withContext(Dispatchers.Main) {
          when (launch) {
            is KrdpassAuth.AuthLaunch.Failure -> {
              if (detach(f)) promise.reject(launch.error.error, launch.error.message ?: "")
            }
            is KrdpassAuth.AuthLaunch.Ready -> {
              if (flight.get() !== f) return@withContext
              f.signInPending = pending
              try {
                launchForAuthentication(activity, launch)
                scheduleAuthTimeout(f, args.timeoutSeconds)
              } catch (e: Exception) {
                if (detach(f)) promise.reject("launch_failed", e.message ?: "Failed to open KRDPASS", e)
              }
            }
          }
        }
      } catch (e: CancellationException) {
        // invalidate() already settled the flight; a cancelled coroutine must propagate.
        throw e
      } catch (e: Exception) {
        // Classify rather than assume: this wraps the PAR round trip, so a real transport
        // failure keeps its retryable code and only a codeless one becomes the generic fallback.
        withContext(Dispatchers.Main) {
          if (detach(f)) promise.reject(krdpassErrorCode(e), e.message, e)
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
    val args = parseAuthenticateArgs(configValue.toHashMap(), promise) ?: return
    val f = Flight(
      promise = promise,
      config = args.config,
      expectedState = args.state,
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
        when (val launch = KrdpassAuth.startAuthentication(activity, f.config, args.requestUri, args.state ?: "")) {
          is KrdpassAuth.AuthLaunch.Failure -> {
            if (detach(f)) promise.resolve(authResultToMap(launch.error))
          }
          is KrdpassAuth.AuthLaunch.Ready -> {
            if (flight.get() !== f) return@withContext
            try {
              launchForAuthentication(activity, launch)
              scheduleAuthTimeout(f, args.timeoutSeconds)
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
    val timeout = config.hasKey("timeout") && config.getBoolean("timeout")
    val f = flight.getAndSet(null)
    if (f == null) {
      promise.resolve(false)
      return
    }
    // Tell the core too: it owns the pending window, and without this a flow cancelled here
    // still blocks the next one.
    KrdpassAuth.cancelPendingAuthentication(timeout)
    settleTerminal(f, timeout)
    promise.resolve(true)
  }

  @DoNotStrip
  override fun getUserInfo(configValue: ReadableMap, promise: Promise) {
    val config = configValue.toHashMap()
    val clientId = requireArg(config, "clientId", promise) ?: return
    val accessToken = requireArg(config, "accessToken", promise) ?: return
    val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return
    launchSettling(promise, "user_info_failed") {
      promise.resolve(nativeMap(KrdpassAuth.getUserInfo(clientId, environment, accessToken).raw))
    }
  }

  @DoNotStrip
  override fun refreshTokens(configValue: ReadableMap, promise: Promise) {
    val config = configValue.toHashMap()
    val clientId = requireArg(config, "clientId", promise) ?: return
    val refreshToken = requireArg(config, "refreshToken", promise) ?: return
    val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return
    launchSettling(promise, "refresh_failed") {
      promise.resolve(tokensToMap(
        KrdpassAuth.refreshTokens(clientId, environment, refreshToken, config["scope"] as? String)))
    }
  }

  @DoNotStrip
  override fun revokeToken(configValue: ReadableMap, promise: Promise) {
    val config = configValue.toHashMap()
    val clientId = requireArg(config, "clientId", promise) ?: return
    val token = requireArg(config, "token", promise) ?: return
    val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return
    launchSettling(promise, "revoke_failed") {
      KrdpassAuth.revokeToken(clientId, environment, token, config["tokenTypeHint"] as? String)
      promise.resolve(null)
    }
  }

  @DoNotStrip
  override fun verifyToken(configValue: ReadableMap, promise: Promise) {
    val config = configValue.toHashMap()
    val clientId = requireArg(config, "clientId", promise) ?: return
    val idToken = requireArg(config, "idToken", promise) ?: return
    val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return
    val clockSkewSeconds = (config["clockSkew"] as? Number)?.toLong() ?: 60L
    launchSettling(promise, "verification_failed") {
      promise.resolve(nativeMap(KrdpassAuth.verifyToken(clientId, environment, idToken, clockSkewSeconds)))
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

  /**
   * Settles [f] with its terminal outcome: signIn rejects (it promises tokens), authenticate
   * resolves an AuthResult. Both read the same mapped fields, so the two shapes cannot drift.
   */
  private fun settleTerminal(f: Flight, timeout: Boolean) {
    f.timeoutJob?.cancel()
    val terminal: AuthResult = if (timeout) AuthResult.Timeout else AuthResult.Cancelled
    val fields = BridgeMapping.authResultFields(terminal)
    if (f.isSignIn) f.promise.reject(fields["error"] as String, fields["error_description"] as? String ?: "")
    else f.promise.resolve(nativeMap(fields))
  }

  /**
   * Runs [body] on the module scope and settles [promise] however it ends. The core's own code
   * wins on failure; [fallbackCode] fills in only when it carries none, so a transient
   * network_error is never reported as a permanent per-call failure. A coroutine cancelled by
   * teardown rejects too; without that the JS promise never settles.
   */
  private fun launchSettling(promise: Promise, fallbackCode: String, body: suspend () -> Unit) {
    val settled = AtomicBoolean(false)
    scope.launch {
      try {
        body()
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        promise.reject(sdkErrorCode(e) ?: fallbackCode, e.message, e)
      }
      settled.set(true)
    }.invokeOnCompletion { cause ->
      if (cause is CancellationException && settled.compareAndSet(false, true)) {
        promise.reject("cancelled", AuthResult.Cancelled.message ?: "")
      }
    }
  }

  private fun scheduleAuthTimeout(f: Flight, timeoutSeconds: Double) {
    val timeoutMillis = (timeoutSeconds * 1000.0).toLong()
    if (timeoutMillis <= 0L) return
    f.timeoutJob = scope.launch {
      delay(timeoutMillis)
      withContext(Dispatchers.Main) {
        if (detach(f)) settleTerminal(f, timeout = true)
      }
    }
  }

  private fun resolveAuthError(promise: Promise, error: String, description: String) {
    promise.resolve(nativeMap(BridgeMapping.errorFields(error, description)))
  }

  private fun authResultToMap(result: AuthResult) = nativeMap(BridgeMapping.authResultFields(result))

  private fun sdkErrorCode(e: Throwable): String? = BridgeMapping.errorCode(e)

  private fun krdpassErrorCode(e: Throwable): String = sdkErrorCode(e) ?: "authentication_failed"

  private fun tokensToMap(tokens: KrdpassTokenResult) = nativeMap(BridgeMapping.tokenFields(tokens))

  private fun nativeMap(values: Map<String, Any?>) =
    Arguments.makeNativeMap(values.mapValues { BridgeMapping.normalize(it.value) })

  private fun parseEnvironmentOrReject(value: Any?, promise: Promise): KrdpassEnvironment? {
    val parsed = BridgeMapping.environment(value)
    if (parsed == null) promise.reject("invalid_request", "environment must be PRODUCTION or DEVELOPMENT")
    return parsed
  }

  /**
   * The non-blank string for [key], or null after rejecting [promise]: blank and absent
   * classify identically on every method.
   */
  private fun requireArg(config: Map<String, Any?>, key: String, promise: Promise): String? {
    val value = config[key] as? String
    if (value.isNullOrBlank()) {
      promise.reject("invalid_request", "$key is required")
      return null
    }
    return value
  }

  private class SignInArgs(
    val config: KrdpassConfig,
    val scopes: List<String>,
    val timeoutSeconds: Double,
  )

  private class AuthenticateArgs(
    val config: KrdpassConfig,
    val requestUri: String,
    val state: String?,
    val timeoutSeconds: Double,
  )

  /** Parsed [signIn] options, or null after rejecting [promise] with the reason. */
  private fun parseSignInArgs(config: Map<String, Any?>, promise: Promise): SignInArgs? {
    val clientId = requireArg(config, "clientId", promise) ?: return null
    val redirectUri = requireArg(config, "redirectUri", promise) ?: return null
    val environment = parseEnvironmentOrReject(config["environment"], promise) ?: return null
    // A bad timeout is rejected, never silently replaced with the default.
    val timeoutSeconds = (config["timeout"] as? Number)?.toDouble() ?: 300.0
    if (timeoutSeconds <= 0 || !timeoutSeconds.isFinite()) {
      promise.reject("platform_error", "timeout must be a positive number of seconds")
      return null
    }
    return SignInArgs(
      config = KrdpassConfig(clientId, redirectUri, environment),
      scopes = (config["scopes"] as? String ?: "openid profile")
        .split(" ")
        .filter { it.isNotBlank() },
      timeoutSeconds = timeoutSeconds,
    )
  }

  /**
   * Parsed [authenticate] options, or null after settling [promise] with the reason. Every bad
   * option resolves as an AuthResult error: authenticate promises callers a result, never a
   * rejection.
   */
  private fun parseAuthenticateArgs(config: Map<String, Any?>, promise: Promise): AuthenticateArgs? {
    val clientId = config["clientId"] as? String
    if (clientId.isNullOrBlank()) {
      resolveAuthError(promise, "platform_error", "clientId is required")
      return null
    }
    val redirectUri = config["redirectUri"] as? String
    if (redirectUri.isNullOrBlank()) {
      resolveAuthError(promise, "platform_error", "redirectUri is required")
      return null
    }
    val requestUri = config["requestUri"] as? String
    if (requestUri.isNullOrBlank()) {
      resolveAuthError(promise, "platform_error", "requestUri is required")
      return null
    }
    val timeoutSeconds = (config["timeout"] as? Number)?.toDouble() ?: 300.0
    if (timeoutSeconds <= 0 || !timeoutSeconds.isFinite()) {
      resolveAuthError(promise, "platform_error", "timeout must be a positive number of seconds")
      return null
    }
    val environment = BridgeMapping.environment(config["environment"]) ?: run {
      resolveAuthError(promise, "platform_error", "environment must be PRODUCTION or DEVELOPMENT")
      return null
    }
    return AuthenticateArgs(
      config = KrdpassConfig(clientId, redirectUri, environment),
      requestUri = requestUri,
      state = config["state"] as? String,
      timeoutSeconds = timeoutSeconds,
    )
  }

  companion object {
    const val NAME = "KrdpassAuthReactNative"
    const val AUTH_REQUEST_CODE = 9988
  }
}

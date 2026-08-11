package krdpass.auth.reactnative

import krd.pass.auth.AuthResult
import krd.pass.auth.KrdpassEnvironment
import krd.pass.auth.KrdpassError
import krd.pass.auth.KrdpassTokenResult
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.Date
import java.util.Locale

/**
 * The bridge's pure mapping layer: core SDK types in, plain Kotlin values out. No React Native
 * and no Android framework types, so it runs in a plain JVM unit test (BridgeMappingTest).
 * Codes here are the same lowercase strings the other SDKs use: the public contract.
 */
internal object BridgeMapping {

  /**
   * The core SDK's own wire code for [e], or null when it carries none so the call site can
   * apply its per-call fallback. IOException is explicit because a transport-level failure
   * escapes OkHttp as a raw IOException, and that is exactly the retryable network_error case
   * the taxonomy exists for.
   */
  fun errorCode(e: Throwable): String? = when (e) {
    is KrdpassError -> e.code
    is IOException -> "network_error"
    else -> null
  }

  /**
   * The JS object for an [AuthResult]: `code`/`state` on success, `error`/`error_description`
   * otherwise. Exhaustive with no `else`, so a new core result case is a compile error here
   * rather than a wrong code on the wire.
   */
  fun authResultFields(result: AuthResult): Map<String, Any?> = when (result) {
    is AuthResult.Success -> mapOf("code" to result.code, "state" to result.state)
    // errorDescription, not message: message falls back to the error code, and the wire
    // contract omits error_description entirely when the core supplied none.
    is AuthResult.Error -> errorFields(result.error, result.errorDescription)
    AuthResult.Cancelled -> errorFields("cancelled", result.message)
    AuthResult.Timeout -> errorFields("timeout", result.message)
    AuthResult.Busy -> errorFields("busy", result.message)
  }

  /** A null [description] omits the key, matching iOS: absent means "neither side supplied one". */
  fun errorFields(error: String, description: String?): Map<String, Any?> =
    if (description == null) mapOf("error" to error)
    else mapOf("error" to error, "error_description" to description)

  /** The JS object for a token result, shared by the signIn and refreshTokens paths. */
  fun tokenFields(tokens: KrdpassTokenResult): Map<String, Any?> = mapOf(
    "accessToken" to tokens.accessToken,
    "idToken" to tokens.idToken,
    "refreshToken" to tokens.refreshToken,
    "expiresIn" to tokens.expiresIn,
    "tokenType" to tokens.tokenType,
    "scope" to tokens.scope,
  )

  /**
   * The environment for a JS `environment` option, or null when it is not one of the two names
   * the JS layer's own validation accepts (any case, trimmed). Absent or null means production.
   * Kept in step with the iOS bridge's parseEnvironment.
   */
  fun environment(value: Any?): KrdpassEnvironment? {
    if (value == null || value === JSONObject.NULL) return KrdpassEnvironment.Production
    return when ((value as? String)?.trim()?.uppercase(Locale.ROOT)) {
      "PRODUCTION" -> KrdpassEnvironment.Production
      "DEVELOPMENT" -> KrdpassEnvironment.Development
      else -> null
    }
  }

  /**
   * Rewrites a core value into something Arguments.makeNativeMap accepts: Dates as epoch seconds,
   * org.json containers as plain maps and lists, JSONObject.NULL as null. Recursive, because
   * userinfo and ID-token claims nest.
   */
  fun normalize(value: Any?): Any? {
    if (value == null || value === JSONObject.NULL) return null
    return when (value) {
      is Date -> value.time / 1000
      is JSONObject -> buildMap {
        val keys = value.keys()
        while (keys.hasNext()) {
          val key = keys.next()
          put(key, normalize(value.opt(key)))
        }
      }
      is JSONArray -> List(value.length()) { normalize(value.opt(it)) }
      is Map<*, *> -> value.entries.associate { it.key.toString() to normalize(it.value) }
      is Iterable<*> -> value.map { normalize(it) }
      is Array<*> -> value.map { normalize(it) }
      else -> value
    }
  }
}

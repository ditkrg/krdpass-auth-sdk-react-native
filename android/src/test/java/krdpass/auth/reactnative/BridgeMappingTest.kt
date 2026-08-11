package krdpass.auth.reactnative

import krd.pass.auth.AuthResult
import krd.pass.auth.KrdpassEnvironment
import krd.pass.auth.KrdpassError
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.IOException
import java.util.Date

/**
 * Plain JVM tests for the bridge's mapping layer, where the cross-SDK wire contract can
 * silently drift.
 */
class BridgeMappingTest {

  @Test
  fun `forwards the core's own wire code`() {
    assertEquals("cancelled", BridgeMapping.errorCode(KrdpassError.UserCancelled()))
    assertEquals("timeout", BridgeMapping.errorCode(KrdpassError.Timeout()))
    assertEquals("busy", BridgeMapping.errorCode(KrdpassError.Busy()))
    assertEquals("network_error", BridgeMapping.errorCode(KrdpassError.NetworkError("down")))
    assertEquals("invalid_request", BridgeMapping.errorCode(KrdpassError.ConfigurationError("bad")))
    assertEquals(
      "state_mismatch",
      BridgeMapping.errorCode(KrdpassError.AuthenticationFailed("nope", code = "state_mismatch")),
    )
  }

  @Test
  fun `has no code for a codeless or foreign failure`() {
    // Null is the signal that lets each call site apply its own fallback (refresh_failed, ...).
    assertNull(BridgeMapping.errorCode(KrdpassError.AuthenticationFailed("nope")))
    assertNull(BridgeMapping.errorCode(IllegalStateException("boom")))
  }

  @Test
  fun `classifies a raw transport failure as retryable`() {
    // OkHttp transport failures escape the core's CAS translation as a bare IOException.
    assertEquals("network_error", BridgeMapping.errorCode(IOException("connection reset")))
  }

  @Test
  fun `maps success to code and state, never to an error`() {
    assertEquals(
      mapOf("code" to "abc", "state" to "xyz"),
      BridgeMapping.authResultFields(AuthResult.Success("abc", "xyz")),
    )
    assertEquals(
      mapOf("code" to "abc", "state" to null),
      BridgeMapping.authResultFields(AuthResult.Success("abc")),
    )
  }

  @Test
  fun `maps every failure to the canonical wire code`() {
    assertEquals(
      mapOf("error" to "cancelled", "error_description" to "Authentication was cancelled"),
      BridgeMapping.authResultFields(AuthResult.Cancelled),
    )
    assertEquals(
      mapOf("error" to "timeout", "error_description" to "Authentication timed out"),
      BridgeMapping.authResultFields(AuthResult.Timeout),
    )
    assertEquals(
      mapOf("error" to "busy", "error_description" to "Another authentication is already in progress"),
      BridgeMapping.authResultFields(AuthResult.Busy),
    )
    assertEquals(
      mapOf("error" to "no_code", "error_description" to "No authorization code received"),
      BridgeMapping.authResultFields(AuthResult.Error("no_code", "No authorization code received")),
    )
  }

  @Test
  fun `omits error_description when an error carries none`() {
    assertEquals(
      mapOf<String, Any?>("error" to "some_server_code"),
      BridgeMapping.authResultFields(AuthResult.Error("some_server_code")),
    )
  }

  @Test
  fun `keeps the description an error carries`() {
    assertEquals(
      mapOf("error" to "some_server_code", "error_description" to "Server says no"),
      BridgeMapping.authResultFields(AuthResult.Error("some_server_code", "Server says no")),
    )
  }

  @Test
  fun `defaults the environment to production`() {
    assertEquals(KrdpassEnvironment.Production, BridgeMapping.environment(null))
    assertEquals(KrdpassEnvironment.Production, BridgeMapping.environment(JSONObject.NULL))
  }

  @Test
  fun `parses the environment case-insensitively and trimmed`() {
    assertEquals(KrdpassEnvironment.Production, BridgeMapping.environment("production"))
    assertEquals(KrdpassEnvironment.Production, BridgeMapping.environment("  PRODUCTION "))
    assertEquals(KrdpassEnvironment.Development, BridgeMapping.environment("Development"))
  }

  @Test
  fun `rejects an unknown or non-string environment`() {
    assertNull(BridgeMapping.environment("staging"))
    // "dev" is not an alias: only the two names the JS layer's own validation accepts work here.
    assertNull(BridgeMapping.environment("dev"))
    assertNull(BridgeMapping.environment(""))
    assertNull(BridgeMapping.environment(7))
  }

  @Test
  fun `converts dates to epoch seconds`() {
    // Claims like auth_time and exp are seconds on the wire; milliseconds would date a token
    // 50000 years out and every expiry check downstream would pass.
    assertEquals(1_700_000_000L, BridgeMapping.normalize(Date(1_700_000_000_000L)))
  }

  @Test
  fun `flattens nested json into plain containers`() {
    val claims = JSONObject()
      .put("sub", "123")
      .put("upns", JSONArray().put("a@krd").put("b@krd"))
      .put("address", JSONObject().put("city", "Erbil"))
      .put("middle_name", JSONObject.NULL)

    assertEquals(
      mapOf(
        "sub" to "123",
        "upns" to listOf("a@krd", "b@krd"),
        "address" to mapOf("city" to "Erbil"),
        "middle_name" to null,
      ),
      BridgeMapping.normalize(claims),
    )
  }

  @Test
  fun `normalizes maps, iterables and arrays recursively`() {
    assertEquals(
      mapOf("at" to 1_700_000_000L),
      BridgeMapping.normalize(mapOf("at" to Date(1_700_000_000_000L))),
    )
    assertEquals(listOf(1_700_000_000L), BridgeMapping.normalize(listOf(Date(1_700_000_000_000L))))
    assertEquals(listOf("a", "b"), BridgeMapping.normalize(arrayOf("a", "b")))
  }

  @Test
  fun `passes scalars through untouched`() {
    assertEquals("plain", BridgeMapping.normalize("plain"))
    assertEquals(42, BridgeMapping.normalize(42))
    assertEquals(true, BridgeMapping.normalize(true))
    assertNull(BridgeMapping.normalize(null))
  }

  @Test
  fun `tokenFields sends all six keys, absent optionals as null`() {
    val fields = BridgeMapping.tokenFields(
      krd.pass.auth.KrdpassTokenResult(
        accessToken = "access-1",
        idToken = null,
        tokenType = "Bearer",
        expiresIn = 3600,
        refreshToken = null,
        scope = null,
      ),
    )
    assertEquals(
      setOf("accessToken", "idToken", "refreshToken", "expiresIn", "tokenType", "scope"),
      fields.keys,
    )
    assertEquals("access-1", fields["accessToken"])
    // Nulls stay: the JS layer's `?? undefined` coercion is written for exactly this shape.
    assertNull(fields["idToken"])
    assertNull(fields["refreshToken"])
    assertNull(fields["scope"])
  }
}

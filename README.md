# KRDPASS Auth SDK (React Native)

Sign in with KRDPASS for React Native apps. The package wraps the native Android and iOS
cores, which hand off to the installed KRDPASS identity app. It is not a browser or WebView
flow.

One package covers Expo development builds and bare React Native, through Codegen and
autolinking. It does not require consumers to install Expo Modules. **Expo Go is not
supported**, because this package contains custom native code.

## Getting access

KRDPASS credentials are approval-based, not self-service, because integrations can reach
citizen identity data. Email `integration@pass.krd` with:

- Your Android package name and the SHA-256 fingerprint of your signing certificate
- Your iOS bundle identifier, Apple Team ID, and Universal Link host
- The scopes you need
- Your HTTPS `redirectUri`

You get back a `clientId`. Refresh tokens (`refreshTokens`, `revokeToken`) are approved
separately and are usually off for a new integration; ask if you need them.

**Register every signing certificate you ship from.** KRDPASS validates the signing
certificate of the app that launches it, not just the `clientId`. A build signed with an
unregistered key is rejected with `invalid_client` even when the `clientId`, `redirectUri`
and scopes are all correct. On Android that means debug, internal-distribution and Play App
Signing certificates. On iOS the registered bundle ID and team must match the build.

Protocol reference:
<https://docs.digital.gov.krd/software-development/04-interoperability/11-krdpass-sign-in-with-krdpass.html>

## Requirements

- React Native 0.84, React 19.1, or newer (New Architecture only)
- Expo SDK 57 or newer, for Expo apps (development build or EAS Build)
- Android `minSdk` 24, iOS 15.5
- A `clientId`, approved scopes, and an HTTPS `redirectUri`

## Install

```bash
npm install github:ditkrg/krdpass-auth-sdk-react-native#v1.5.0
npm install react-native-get-random-values@^2.0.0
```

`react-native-get-random-values` is the CSPRNG behind `generateState()`, and the only thing
that uses it: PKCE comes from the native cores. It is loaded when you call `generateState()`
rather than at import, so an app that never calls it is never handed a patched
`globalThis.crypto`. Installing from GitHub runs this package's `prepare` build, so lifecycle
scripts must be enabled.

If you never call `generateState()` you can skip it, with one caveat about bundling. The
`require` sits inside a `try`/`catch`, and the default React Native and Expo Metro configs set
`transformer.allowOptionalDependencies: true`, which is exactly what makes an unresolvable
`require` in that position a caught runtime error instead of a bundling failure. Metro's own
default for that option is `false`, so a hand-rolled `metro.config.js` that does not build on
`@react-native/metro-config` or `expo/metro-config` will fail the bundle unless the package is
installed. That is why it is declared as an optional peer dependency rather than left undeclared.

The Android bridge depends on `krd.pass:krdpass-auth`, which resolves from Maven Central
through your app's existing repositories. No extra Gradle configuration.

## Platform setup

### Expo

Add the bundled config plugin to your app config:

```json
{
  "expo": {
    "plugins": ["krdpass-auth-react-native"]
  }
}
```

Then `npx expo prebuild` and create a development build (`npx expo run:ios`,
`npx expo run:android`) or an EAS build. The plugin applies the Android `launchMode` and
`<queries>` entries and the iOS `KrdpassAuth` pod source. It runs at prebuild time only;
at runtime the app uses ordinary autolinking.

### Bare React Native

Autolinking picks up the Android module and the iOS podspec. The Android 11+ package
visibility `<queries>` entries ship in the library's own manifest and merge into your app
automatically. Three things are yours:

**1. Android `MainActivity` must use `launchMode="singleTask"`.** This is the one manual
Android step.

**2. Add the iOS core pod source** to your `Podfile`. CocoaPods cannot express a git source
for a transitive dependency of a library podspec, so this one declaration has to be in the
host app:

```ruby
pod 'KrdpassAuth', :git => 'https://github.com/ditkrg/krdpass-auth-sdk-ios.git', :tag => 'v1.5.0'
```

**3. Enable Associated Domains** for your redirect host, and forward Universal Links from
your `AppDelegate` to `RCTLinkingManager`. Without this, sign-in appears to hang: KRDPASS
returns to your app and the result never reaches the SDK. No `Info.plist` change is needed;
KRDPASS registers no custom URL scheme.

Then `npx pod-install` and rebuild.

### Supported consumers

| Consumer | Android | iOS |
| --- | --- | --- |
| Expo SDK 57 development build or EAS Build | Supported | Supported |
| Expo Go | Not supported | Not supported |
| Bare React Native 0.84+ | Supported | Supported |
| Bare React Native 0.83 and older | Not supported | Not supported |

CI builds clean React Native 0.86 and Expo SDK 57 consumers on both platforms.

## Quickstart

**1. Initialize once**, at app start. This stores `clientId`, `redirectUri` and
`environment` for every later call; per-call options are limited to `scopes` and `timeout`.
All three are validated here and `initialize` throws on a bad one, so a value that arrived
from an environment variable through a cast fails at startup rather than mid-flow.

```ts
import {
  initialize,
  signIn,
  authenticate,
  generatePkcePair,
  generateState,
  getUserInfo,
  KrdpassAuthError,
  isAuthResultSuccess,
  isAuthResultCancelled,
  isAuthResultTimeout,
  isAuthResultBusy,
  isAuthResultProviderNotInstalled,
} from 'krdpass-auth-react-native';

initialize({
  clientId: 'your-client-id',
  redirectUri: 'https://auth.your-app.example.com/_krdpass/oauth/callback',
  environment: 'production', // or 'development'
});
```

**2a. Client-only sign-in.** The SDK runs PKCE, PAR and the token exchange and hands you
tokens. Simplest to integrate; your client is public, so prefer 2b in production. `signIn`
resolves with tokens and throws on cancel or failure, identically on both platforms.
Client-only sign-in needs a public client, which is not currently issued for any
integration. Use the server-mediated flow (2b).

```ts
try {
  const tokens = await signIn({ scopes: ['openid', 'profile'] });
  const user = await getUserInfo({ accessToken: tokens.accessToken });
} catch (e) {
  if (e instanceof KrdpassAuthError) {
    switch (e.code) {
      case 'cancelled':
        break; // usually no UI needed; both cores fold every decline into this one code
      case 'timeout':
        break; // offer retry
      case 'busy':
        break; // ignore or queue
      case 'state_mismatch':
        break; // fail closed and restart
      case 'provider_not_installed':
        break; // e.installUrl is set, open it
      default:
        console.error(e.code, e.errorDescription);
    }
  }
}
```

**2b. Server-mediated sign-in.** Your backend runs PAR and the token exchange; the SDK
launches KRDPASS and returns the authorization code. PKCE and `state` are yours: generate
both in the app, send only the `codeChallenge` and the `state` to your backend, and hold the
`codeVerifier` until the exchange. Pass that same `state` back into `authenticate`, or the
SDK fails closed with `invalid_request`.

```ts
const pkce = await generatePkcePair();
const state = generateState();

// Your backend runs the PAR with pkce.codeChallenge and state, and returns the request_uri.
const par = await fetchParFromYourBackend({
  codeChallenge: pkce.codeChallenge,
  state,
}); // { requestUri }

const result = await authenticate({ requestUri: par.requestUri, state });
if (isAuthResultSuccess(result)) {
  // send result.code + pkce.codeVerifier + result.state to your backend
} else if (isAuthResultCancelled(result)) {
  // usually no UI needed
} else if (isAuthResultTimeout(result)) {
  // offer retry
} else if (isAuthResultBusy(result)) {
  // ignore or queue
} else if (isAuthResultProviderNotInstalled(result)) {
  // result.installUrl is set, open it
} else {
  // result.error, result.errorDescription
}
```

If your backend returns its own token JSON, wrap it with `makeTokenResult` rather than
casting. A cast compiles but leaves `receivedAt` undefined and `isExpired` missing, so the
first `isExpired()` call throws.

`isExpired()` fails closed: if `expiresIn` is not a finite number, which is what a backend
sending snake_case `expires_in` gives you, the lifetime is unknown and it reports expired
rather than fresh. Map your backend's field names before wrapping.

**3. The rest of the surface.** `KrdpassScopes` carries the canonical scope strings so you do
not hardcode them. `cancelPendingAuthentication` ends a flow the app never got a callback for,
which is what an app-switch back out of KRDPASS looks like; it resolves `true` when there was
one to cancel. `isAuthResultError` is the catch-all guard for an `authenticate` result that is
not a success.

```ts
import {
  KrdpassScopes,
  cancelPendingAuthentication,
  isAuthResultError,
} from 'krdpass-auth-react-native';

const tokens = await signIn({
  scopes: [KrdpassScopes.openid, KrdpassScopes.citizen_identity],
});

// e.g. from an AppState 'active' handler, when no result arrived
const wasPending = await cancelPendingAuthentication();

const result = await authenticate({ requestUri, state });
if (isAuthResultError(result)) {
  console.error(result.error, result.errorDescription);
}
```

## Error handling

`signIn` throws a `KrdpassAuthError` carrying `code`, `errorDescription` and, for
`provider_not_installed`, `installUrl`. So do `getUserInfo`, `refreshTokens`, `revokeToken`,
`verifyToken`, `generatePkcePair` and `cancelPendingAuthentication`: a native failure never
reaches you as a raw bridge rejection. The one exception is deliberate: a bad local argument
(an invalid `timeout`, calling before `initialize()`) throws a plain `Error`, because it is
your integration bug, not an authentication outcome.

`authenticate` resolves with an `AuthResult`; narrow it with the exported `isAuthResult*`
guards. It never throws: a native rejection comes back as an `AuthResult` error carrying the
same codes, and so does a bad local argument (a blank `requestUri`, a non-positive `timeout`)
or calling it before `initialize()`, all as `platform_error`.

Both also carry `rawDescription`: the untouched text from CAS or the native core, before
`errorDescription` was replaced with the canonical message for that code. Log it. Every
cancellation arrives as `cancelled` and shares one user-facing string, so a real reason such
as "not eligible for citizen_identity" survives only on `rawDescription`. The exception is a
flow that ended with no response at all (the user came back to your app without finishing):
there was never a server reason to carry, and both platforms report only the canonical message.

Both surface the same wire codes:

| Code | Meaning | Typical handling |
| --- | --- | --- |
| `cancelled` | User cancelled in KRDPASS. `access_denied`, `user_cancelled`, `login_required` and `consent_denied` are rewritten to this by both cores before you see them, so branch on `cancelled` alone | Usually no UI needed |
| `timeout` | Auth window elapsed | Offer retry |
| `busy` | Another authentication is in progress | Ignore or queue |
| `state_mismatch` | Returned state differs from expected (possible CSRF/response injection) | Fail closed and restart |
| `issuer_mismatch` | The response carried an `iss` that is not the environment's authorization server (RFC 9207 mix-up) | Fail closed and restart |
| `nonce_mismatch` | The id_token carried a `nonce` that is not the one this client sent (possible token replay) | Fail closed and restart |
| `invalid_id_token` | The id_token failed verification: signature, `iss`, `aud`, `exp`, or it was absent from the token response. Deliberately has no canonical message, so read `errorDescription` for the reason | Log and report |
| `invalid_redirect` | Redirect URI does not match the exact configured endpoint (scheme, host, port, path, and fixed query) | Check onboarding config |
| `invalid_request` | Malformed or blank request parameters | Fix the integration |
| `request_expired` | The request_uri expired inside KRDPASS (NOT a cancellation) | Restart with a fresh PAR request |
| `launch_failed` | The KRDPASS app could not be launched | Retry or check installation |
| `provider_not_installed` | KRDPASS app not installed (`installUrl` is provided) | Open it |
| `no_code` | Provider returned no authorization code | Restart the flow |
| `network_error` | Network failure during token exchange | Safe to retry |
| `platform_error` | Platform-level failure such as an unregistered caller | Log and report |
| `authentication_failed` | `signIn` failed and the native core reported no more specific code | Log and report |

`getUserInfo`, `refreshTokens`, `revokeToken`, `verifyToken` and `generatePkcePair` reject with
the same codes, plus these per-call ones. `errorDescription` carries the CAS or native text
verbatim for all of them, because none has a canonical message:

| Code | Meaning | Typical handling |
| --- | --- | --- |
| `refresh_failed`, `revoke_failed`, `user_info_failed`, `verification_failed` | The named call failed for a reason that is not retryable (4xx, malformed response) | Log and report |
| `pkce_generation_failed` | The device could not produce a secure PKCE pair | Fail closed, do not proceed |
| `invalid_request` | Malformed or blank request parameters | Fix the integration |

Redirect validation happens in the native cores; this package does not reimplement it. A
result is accepted only when it returns to your exact registered redirect endpoint: scheme,
host, effective port, encoded path and any fixed query entries must all match.

`verifyToken` checks an ID token's signature against JWKS, and pins the issuer to the
configured environment's authorization server and the audience to your `clientId`, plus the
expiry. The `aud` check is exact, not containment: the token's `aud` must be exactly your
`clientId`, so an ID token listing any additional audience is rejected. Both are pinned on
Android and on iOS: a token signed by a different issuer whose key happens to be in the
fetched JWKS is rejected, and so is a token minted for a different client. The one check this call cannot make is nonce binding, because a nonce only exists
inside a flow that generated one; the client-only `signIn` flow runs everything above plus
that nonce check. `decodeTokenUnverified` does not verify anything and must never drive an
authorization decision.

This SDK has no logging hook, unlike the Android, iOS and Flutter SDKs.

## Token storage

The SDK never persists tokens. Use `expo-secure-store` or `react-native-keychain`, not
`AsyncStorage`. Note that the token and result types are plain interfaces with no custom
`toString`, so `console.log(tokens)` prints the raw access token; redact at the call site.
Full guidance:
[Token Storage](https://github.com/ditkrg/krdpass-auth-samples/blob/main/docs/TOKEN-STORAGE.md).

## Samples

Runnable Android, iOS, Flutter and React Native samples, plus a reference backend, are in
[krdpass-auth-samples](https://github.com/ditkrg/krdpass-auth-samples).

## Development

```bash
npm ci && npm run lint && npm run build && npm run typecheck && npm test
```

## License

[MIT](LICENSE) (c) KRG-DIT.

# KRDPASS Auth SDK (React Native)

Sign in with KRDPASS for React Native apps. The package wraps the native Android and iOS
cores, which hand off to the installed KRDPASS identity app. It is not a browser or WebView
flow.

Full integration guide, onboarding, error codes and security requirements:
**[KRDPASS documentation](https://docs.digital.gov.krd/software-development/04-interoperability/11-krdpass-sign-in-with-krdpass.html)**

## What this package is, and is not

This package is a thin native-module bridge. None of the security-critical protocol code
lives here. PKCE, nonce generation and binding, exact-match redirect URI validation, the ID
token signature check, the `iss` / `aud` / `exp` claim checks and JWKS handling are all in
the native cores:

- Android: [`krd.pass:krdpass-auth`](https://github.com/ditkrg/krdpass-auth-sdk-android)
- iOS: [`KrdpassAuth`](https://github.com/ditkrg/krdpass-auth-sdk-ios)

Auditing this repository is not the same as auditing the KRDPASS sign-in flow.

## Requirements

- React Native 0.84, React 19.1, or newer (New Architecture only)
- Expo SDK 57 or newer, for Expo apps (development build or EAS Build)
- Android `minSdk` 24, iOS 15.5
- A `clientId`, approved scopes, and an HTTPS `redirectUri`. See
  [Getting started](https://docs.digital.gov.krd/software-development/04-interoperability/12-krdpass-getting-started.html).

**Register every signing certificate you ship from.** KRDPASS validates the signing
certificate of the app that launches it, not just the `clientId`. A build signed with an
unregistered key is rejected with `invalid_client` even when the `clientId`, `redirectUri`
and scopes are all correct. On iOS the registered bundle ID and team must match the build.

## Install

```bash
npm install github:ditkrg/krdpass-auth-sdk-react-native#v1.6.0

# only if you call generateState()
npm install react-native-get-random-values
```

`react-native-get-random-values` is an optional peer dependency, and the CSPRNG behind
`generateState()`. React Native's JS runtime has no `crypto.getRandomValues`, and PKCE comes
from the native cores, so `generateState()` is the only thing that needs it. It is required
lazily inside that call rather than at import, so an app that never calls it is never handed
a patched `globalThis.crypto`. Installing from GitHub runs this package's `prepare` build, so
lifecycle scripts must be enabled.

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

### React Native Community CLI

Autolinking picks up the Android module and the iOS podspec. The Android 11+ package
visibility `<queries>` entries ship in the library's own manifest and merge into your app
automatically. Three things are yours:

**1. Android `MainActivity` must use `launchMode="singleTask"`.** This is the one manual
Android step.

**2. Add the iOS core pod source** to your `Podfile`. CocoaPods cannot express a git source
for a transitive dependency of a library podspec, so this one declaration has to be in the
host app:

```ruby
pod 'KrdpassAuth', :git => 'https://github.com/ditkrg/krdpass-auth-sdk-ios.git', :tag => 'v1.6.0'
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
| React Native Community CLI 0.84+ | Supported | Supported |
| React Native 0.83 and older | Not supported | Not supported |

CI builds clean React Native 0.86 and Expo SDK 57 consumers on both platforms.

## Quickstart

**1. Initialize once**, at app start. This stores `clientId`, `redirectUri` and
`environment` for every later call; per-call options are limited to `scopes` and `timeout`.
All three are validated here and `initialize` throws on a bad one, so a value that arrived
from an environment variable through a cast fails at startup rather than mid-flow.

```ts
import { initialize } from 'krdpass-auth-react-native';

initialize({
  clientId: 'your-client-id',
  redirectUri: 'https://auth.your-app.example.com/_krdpass/oauth/callback',
  environment: 'production', // or 'development'
});
```

**2. Sign in.** Your backend runs PAR and the token exchange; the SDK launches KRDPASS and
returns the authorization code. PKCE and `state` are yours: generate both in the app, send
only the `codeChallenge` and the `state` to your backend, and hold the `codeVerifier` until
the exchange. Pass that same `state` back into `authenticate`, or the SDK fails closed with
`invalid_request`.

```ts
import {
  generatePkcePair,
  generateState,
  authenticate,
  isAuthResultSuccess,
  isAuthResultCancelled,
  isAuthResultTimeout,
  isAuthResultBusy,
  isAuthResultProviderNotInstalled,
} from 'krdpass-auth-react-native';

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

The client-only `signIn` API ships but needs a public client, which is not currently issued
to any integration. Use the flow above.

If your backend returns its own token JSON, wrap it with `makeTokenResult` rather than
casting. A cast compiles but leaves `receivedAt` undefined and `isExpired` missing, so the
first `isExpired()` call throws.

`isExpired()` fails closed: if `expiresIn` is not a finite number, which is what a backend
sending snake_case `expires_in` gives you, the lifetime is unknown and it reports expired
rather than fresh. Map your backend's field names before wrapping.

### Recovering an abandoned flow

`cancelPendingAuthentication()` ends a flow the app never got a callback for, which is what
an app-switch back out of KRDPASS looks like. It resolves `true` when there was one to
cancel. Call it from an `AppState` `'active'` handler.

On iOS the native core also detects this itself and settles the flow as `cancelled` within
about half a second. Android has no such watcher, so without this call the flow waits for
its timeout.

## Error handling

Every error code, what emits it, and how to handle it:
[Testing and go-live](https://docs.digital.gov.krd/software-development/04-interoperability/14-krdpass-testing-and-go-live.html).

`isAuthResultError` is the catch-all guard for an `authenticate` result that is not a
success. `invalid_redirect` is Android-only: on iOS the same mismatch ends the flow as
`cancelled`.

## Tokens and identity

`getUserInfo`, `refreshTokens`, `revokeToken`, `verifyToken` and `decodeTokenUnverified` are
exported functions. `KrdpassScopes` carries the canonical scope strings so you do not
hardcode them. Scopes, claims and token handling rules:
[Reference](https://docs.digital.gov.krd/software-development/04-interoperability/15-krdpass-reference.html).

The SDK never persists tokens. Storage requirements:
[Token storage](https://github.com/ditkrg/krdpass-auth-samples/blob/main/docs/TOKEN-STORAGE.md).

## Samples

Runnable apps for all five platforms, plus a reference backend:
[krdpass-auth-samples](https://github.com/ditkrg/krdpass-auth-samples).

## Development

```bash
npm run lint
npm test
```

## License

MIT. See [LICENSE](LICENSE).

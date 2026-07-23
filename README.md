# KRDPASS Auth SDK (React Native)

Official React Native SDK for **Sign in with KRDPASS**: app-to-app SSO with the KRDPASS
identity app (not a browser/WebView flow). One package supports Expo development/EAS builds
and Expo-free bare React Native apps through React Native Codegen and autolinking. It does
**not** use, or require consumers to install, Expo Modules.

KRDPASS credentials are approval-based, not open self-service: onboarding contact is
`integration@pass.krd`, since integrations may access sensitive citizen identity data.
Keep `client_secret` and signing keys server-side, and use the server-mediated flow for
production.

## Requirements

- React Native 0.81+ and React 19.1+; iOS 15.5+ and Android API 24+.
- Expo SDK 57+ development build or EAS Build for Expo applications. **Expo Go is not supported**:
  this package contains custom native code, which Expo Go cannot load.
- A registered KRDPASS client (`clientId`, approved scopes, HTTPS `redirectUri`)
- Production and development environments are both supported (`'production'` / `'development'`)

## Install

Add the package as a git dependency:

```bash
npm install github:ditkrg/krdpass-auth-sdk-react-native#v1.2.0
```

This package requires the `react-native-get-random-values` peer dependency (it powers
the CSPRNG behind PKCE and `state` generation). Install it if your app does not already:

```bash
npm install react-native-get-random-values@^1.11.0
```

Git installs run this package's `prepare` build. Lifecycle scripts must therefore be enabled
when installing from GitHub.

### Android core dependency

The native Android core (`krd.pass:krdpass-auth`) resolves automatically from Maven
Central, no extra repository or token needed.

### Calling-app signing certificate

KRDPASS validates the **signing certificate of the app that launches it**, not just the
`clientId`. During onboarding you register your app's certificate SHA-256 fingerprint
(plus package name / bundle ID) against your client. A build signed with a **different**
key is rejected with `invalid_client` even when the `clientId`, `redirectUri`, and scopes
are all correct.

- **Android:** the SHA-256 of the certificate the APK/AAB is signed with must be
  registered. This includes debug, internal-distribution, and Play App Signing
  certificates: register every fingerprint you ship from, or sign with one registered
  key. The demo app in the KRDPASS demos repository signs its debug build with the
  registered demo keystore.
- **iOS:** the registered bundle ID and team must match the build.

## Platform setup

### Expo setup

`expo` is an optional peer dependency of this library: it is needed only when
Expo Prebuild runs the bundled config plugin. It is not loaded by, or required
for, a bare React Native application.

Add plugin in your app config:

```json
{
  "expo": {
    "plugins": ["krdpass-auth-react-native"]
  }
}
```

Then run:

```bash
npx expo prebuild
```

Then create a new development build (`npx expo run:ios`, `npx expo run:android`) or EAS build.
The plugin applies every Expo-prebuild requirement: Android `launchMode`/`<queries>` and the
iOS `KrdpassAuth` pod source. It is intentionally a build-time config plugin only; the app
uses React Native autolinking at runtime.

### Bare React Native setup

No Expo packages or Expo Modules setup are required. React Native autolinks the Android Gradle
module and iOS Podspec. Apply the app-specific requirements below (the Expo config plugin only
runs in Expo Prebuild flows):

- Android `MainActivity` must use `launchMode="singleTask"`.
- Android manifest should declare package visibility for KRDPASS apps under `<queries>`:

```xml
<queries>
  <package android:name="krd.pass" />
  <package android:name="krd.pass.dev" />
</queries>
```

- iOS needs no `Info.plist` changes: KRDPASS registers no custom URL scheme (Universal Link only).

- iOS Podfile must declare the source for the native `KrdpassAuth` core. CocoaPods cannot express
  a git source for a transitive pod dependency in a library podspec, so this is the one required
  host-level iOS declaration for a bare app:

```ruby
pod 'KrdpassAuth', :git => 'https://github.com/ditkrg/krdpass-auth-sdk-ios.git', :tag => 'v1.1.0'
```

- iOS `AppDelegate` should forward deep links/universal links to React Native `RCTLinkingManager`.

Then rebuild native projects:

```bash
npx pod-install
npx react-native run-android
npx react-native run-ios
```

Bare RN native requirements:
- iOS: enable Associated Domains for your Universal Link redirect host.
- Android: configure approved OAuth `redirectUri` in backend/KRDPASS setup.

### Compatibility matrix

| Consumer | Architecture | Android | iOS | Required action |
| --- | --- | --- | --- | --- |
| Expo SDK 57 development build / EAS Build (Prebuild) | New Architecture | Supported | Supported | Add the bundled config plugin, then rebuild. |
| Expo Go | N/A | Not supported | Not supported | Use a development build; Expo Go cannot load this native library. |
| Bare React Native 0.82+ | New Architecture | Supported | Supported | Autolinking and Codegen are automatic; apply the documented host-app settings, then rebuild. |
| Bare React Native 0.81.x | Legacy or New Architecture | Supported | Supported | Uses the legacy bridge or generated TurboModule as selected by the host; apply the same host-app settings. |

The release gates build clean React Native 0.86 and Expo SDK 57 consumers on Android and iOS,
plus React Native 0.81.6 Android consumers in both legacy and New Architecture modes.
This follows the current library shape used by React Native templates and established native
vendors: a Codegen TurboModule in a normal Android Gradle library and CocoaPods podspec, plus
an Expo config plugin only for prebuild-time host configuration. Expo is not a runtime
dependency of the SDK. The same separation is visible in established native SDK packages such
as [Auth0](https://github.com/auth0/react-native-auth0) (Codegen plus ordinary React Native
native projects) and [Stripe](https://github.com/stripe/stripe-react-native) (native projects
plus a bundled Expo config plugin and optional Expo peer). See React Native's
[Turbo Native Module guidance](https://reactnative.dev/docs/turbo-native-modules-introduction)
and Expo's
[library config-plugin guidance](https://docs.expo.dev/config-plugins/development-for-libraries/).

## Quickstart

1. **Initialize**, once at app startup. Stores `clientId`, `redirectUri`, and `environment`
   as defaults for every subsequent call (per-call options are limited to `scopes` and
   `timeout`; identity config always comes from `initialize()`):

   ```ts
   import {
     initialize,
     signIn,
     authenticate,
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

2. **Client-only sign-in (no backend)**: the SDK handles PKCE, launches KRDPASS, and
   exchanges the authorization code for tokens. `signIn()` resolves with tokens on success
   and **throws** on cancel/failure (identically on Android and iOS):

   ```ts
   try {
     const tokens = await signIn({ scopes: ['openid', 'profile'] });
     const user = await getUserInfo({ accessToken: tokens.accessToken });
   } catch (e) {
     if (e instanceof KrdpassAuthError) {
       switch (e.code) {
         case 'cancelled':
         case 'access_denied':
           break; // usually no UI needed
         case 'timeout':
           break; // offer retry
         case 'busy':
           break; // ignore or queue
         case 'state_mismatch':
           break; // fail closed and restart
         case 'provider_not_installed':
           // e.installUrl is set, open it
           break;
         default:
           // e.errorDescription: human-readable reason (if provided)
           console.error(e.code, e.errorDescription);
       }
     }
   }
   ```

3. **Server-mediated flow (recommended for production)**: your backend performs PAR and
   returns a `requestUri` plus the `state` it generated for the request; pass both to
   `authenticate()`. Both native cores reject a blank `state` with `invalid_request`.

   ```ts
   const par = await fetchParFromYourBackend(); // { requestUri, state }
   const result = await authenticate({ requestUri: par.requestUri, state: par.state });
   if (isAuthResultSuccess(result)) {
     // send result.code + result.state to your backend to exchange for tokens
   } else if (isAuthResultCancelled(result)) {
     // usually no UI needed
   } else if (isAuthResultTimeout(result)) {
     // offer retry
   } else if (isAuthResultBusy(result)) {
     // ignore or queue
   } else if (isAuthResultProviderNotInstalled(result)) {
     // result.installUrl is set, open it
   } else {
     // result.error / result.errorDescription
   }
   ```

See [Sign in with KRDPASS](https://docs.digital.gov.krd/software-development/04-interoperability/11-krdpass-sign-in-with-krdpass.html)
for the backend integration reference.

## Error handling

| Code | Meaning | Typical handling |
| --- | --- | --- |
| `cancelled` | User cancelled in KRDPASS (`access_denied` / `user_cancelled` / `login_required` / `consent_denied` are classified as cancellation too) | Usually no UI needed |
| `access_denied` | User declined consent (classified as cancellation) | Usually no UI needed |
| `timeout` | Auth window elapsed | Offer retry |
| `busy` | Another authentication is in progress | Ignore or queue |
| `state_mismatch` | Returned state differs from expected (possible CSRF/response injection) | Fail closed and restart |
| `invalid_redirect` | Redirect URI does not match the configured host | Check onboarding config |
| `invalid_request` | Malformed or blank request parameters | Fix the integration |
| `request_expired` | The request_uri expired inside KRDPASS (NOT a cancellation) | Restart with a fresh PAR request |
| `launch_failed` | The KRDPASS app could not be launched | Retry or check installation |
| `provider_not_installed` | KRDPASS app not installed (`installUrl` is provided) | Open it |
| `no_code` | Provider returned no authorization code | Restart the flow |
| `network_error` | Network failure during token exchange | Safe to retry |
| `platform_error` | Platform-level failure such as an unregistered caller | Log and report |

The **client-only** `signIn` flow throws a `KrdpassAuthError` with a `.code` (plus
`.errorDescription` and, for `provider_not_installed`, `.installUrl`). Catch it and
switch on `.code`. The **server-mediated** `authenticate` flow returns an `AuthResult`
union (`AuthResultSuccess | AuthResultError`); use the exported type guards
(`isAuthResultSuccess`, `isAuthResultCancelled`, `isAuthResultTimeout`, `isAuthResultBusy`,
`isAuthResultProviderNotInstalled`, `isAuthResultError`) to narrow it instead of checking
`error` strings by hand.

## Refresh Token Policy

`refreshTokens` and `revokeToken` APIs are available for approved integrations, but refresh token issuance is high-sensitivity and usually not enabled by default for early integrations.

## Required Onboarding Inputs

- `clientId`
- Approved scopes
- HTTPS `redirectUri`
- Android package name + SHA-256 fingerprint
- iOS bundle ID + team ID + associated domain

## Example App

A complete demo Expo app, covering both the client-only and server-mediated flows, is
maintained in the KRDPASS demos repository.

## Security Notes

- Keep `client_secret` and private keys server-side.
- Never commit secrets, keystores, or `.env` files.

## Backend & Protocol Reference

- Integration guide: <https://docs.digital.gov.krd/software-development/04-interoperability/11-krdpass-sign-in-with-krdpass.html>

## Development

```bash
npm test
npm run build
npm run lint
```

## License

[MIT](LICENSE) (c) KRG-DIT.

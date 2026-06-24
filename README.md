# KRDPASS Auth SDK (React Native)

Official React Native SDK for **Sign in with KRDPASS**.

## Credential Issuance and Trust Model

KRDPASS credentials are approval-based (not open self-service) because integrations may access sensitive citizen identity data.

- Onboarding contact: `integration@pass.krd`
- Keep `client_secret` and signing keys on backend only
- Use server-mediated OAuth for production

## Compatibility

One package supports both:

- Expo managed/dev-client apps
- Bare React Native apps (non-Expo app) after Expo Modules runtime setup

## Install (v1)

Add the package as a git dependency (no public registry):

```bash
npm install "git+ssh://git@github.com/ditkrg/krdpass-auth-sdk-react-native.git#v1.0.0"
```

This package runs a `prepare` build on install. If npm scripts are disabled, run once:

```bash
cd node_modules/krdpass-auth-react-native
npm run build
```

### Android core dependency (GitHub Packages)

The Android side of this SDK depends on the native KRDPASS core, published privately to
**GitHub Packages** as `krd.pass:krdpass-auth`. A Gradle library cannot declare the
repositories it is resolved from, so **your app** must add the repository (and a
`read:packages` token) to `android/build.gradle`:

```groovy
allprojects {
  repositories {
    google()
    mavenCentral()
    maven {
      url = uri('https://maven.pkg.github.com/ditkrg/krdpass-auth-sdk-android')
      credentials {
        username = project.findProperty('gpr.user') ?: System.getenv('GITHUB_ACTOR')
        password = project.findProperty('gpr.token') ?: System.getenv('GITHUB_TOKEN')
      }
    }
  }
}
```

Supply the credentials via `~/.gradle/gradle.properties` (`gpr.user` / `gpr.token`) or the
`GITHUB_ACTOR` / `GITHUB_TOKEN` environment variables; the token only needs the
`read:packages` scope. Without this, the Android build fails with
`Could not find krd.pass:krdpass-auth`. See `example/android/build.gradle` for a working
reference.

### Calling-app signing certificate

KRDPASS validates the **signing certificate of the app that launches it**, not just the
`clientId`. During onboarding you register your app's certificate SHA-256 fingerprint
(plus package name / bundle ID) against your client. A build signed with a **different**
key is rejected with `invalid_client` even when the `clientId`, `redirectUri`, and scopes
are all correct.

- **Android:** the SHA-256 of the certificate the APK/AAB is signed with must be
  registered. This includes debug, internal-distribution, and Play App Signing
  certificates — register every fingerprint you ship from, or sign with one registered
  key. The bundled example signs its debug build with the registered demo keystore (see
  `example/android/key.properties.example`).
- **iOS:** the registered bundle ID and team must match the build.

## Quickstart

```ts
import {
  initialize,
  signIn,
  getUserInfo,
  KrdpassAuthError,
} from 'krdpass-auth-react-native';

// Call once at app startup. Stores clientId/redirectUri/environment as
// defaults for every subsequent call (you can still override per call).
initialize({
  clientId: 'your-client-id',
  redirectUri: 'https://auth.your-app.example.com/_krdpass/oauth/callback',
  environment: 'production', // or 'development'
});

// Client-only direct flow: the SDK handles PKCE, launches KRDPASS,
// and exchanges the authorization code for tokens. No backend required.
// signIn() resolves with tokens on success and THROWS on cancel/failure
// (identically on Android and iOS).
try {
  const tokens = await signIn({ scopes: ['openid', 'profile'] });
  const user = await getUserInfo({ accessToken: tokens.accessToken });
} catch (e) {
  if (e instanceof KrdpassAuthError) {
    // e.code: 'cancelled' | 'state_mismatch' | 'timeout' | 'no_code' | ...
    // e.errorDescription: human-readable reason (if provided)
  }
}
```

For server-mediated production flows, your backend performs PAR + token
exchange and returns a `requestUri`; pass it to `authenticate()`:

```ts
const result = await authenticate({ requestUri }); // { code, state } on success
```

See [Sign in with KRDPASS](https://docs.digital.gov.krd/software-development/04-interoperability/11-krdpass-sign-in-with-krdpass.html)
for the backend integration reference.

### Expo setup

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

### Bare React Native setup

Install Expo Modules runtime in your bare app:

```bash
npx install-expo-modules@latest
```

Apply native settings (the Expo config plugin only runs in Expo config flows):

- Android `MainActivity` must use `launchMode="singleTask"`.
- Android manifest should declare package visibility for KRDPASS apps under `<queries>`:

```xml
<queries>
  <package android:name="krd.pass" />
  <package android:name="krd.pass.staging" />
  <package android:name="krd.pass.dev" />
</queries>
```

- iOS `Info.plist` should include:

```xml
<key>LSApplicationQueriesSchemes</key>
<array>
  <string>krdpass</string>
</array>
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

## Required Onboarding Inputs

- `clientId`
- Approved scopes
- HTTPS `redirectUri`
- Android package name + SHA-256 fingerprint
- iOS bundle ID + team ID + associated domain

## Refresh Token Policy

`refreshTokens` and `revokeToken` APIs are available for approved integrations, but refresh token issuance is high-sensitivity and usually not enabled by default for early integrations.

## Example App

- A complete demo Expo app lives in the `example/` directory of this repository.
- See `example/README.md` for setup instructions.

## Security Notes

- Keep `client_secret` and private keys server-side.
- Never commit secrets, keystores, or `.env` files.

## Related Docs

- Sign in with KRDPASS (backend integration reference): https://docs.digital.gov.krd/software-development/04-interoperability/11-krdpass-sign-in-with-krdpass.html

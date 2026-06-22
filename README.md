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

## Quickstart

```ts
import { initialize, signIn, authenticate, getUserInfo } from 'krdpass-auth-react-native';

// Call once at app startup. Stores clientId/redirectUri/environment as
// defaults for every subsequent call (you can still override per call).
initialize({
  clientId: 'your-client-id',
  redirectUri: 'https://auth.your-app.example.com/_krdpass/oauth/callback',
  environment: 'production', // or 'development'
});

// Client-only direct flow: the SDK handles PKCE, launches KRDPASS,
// and exchanges the authorization code for tokens. No backend required.
const tokens = await signIn({
  clientId: 'your-client-id',
  redirectUri: 'https://auth.your-app.example.com/_krdpass/oauth/callback',
  scopes: ['openid', 'profile'],
});

// Fetch user claims with the access token.
const user = await getUserInfo({ accessToken: tokens.accessToken });
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

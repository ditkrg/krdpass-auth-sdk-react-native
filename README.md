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

## Install from This Repository (v1)

1. Clone the repo:

```bash
git clone https://github.com/ditkrg/krdpass-auth-sdk.git
```

2. Install from local path:

```bash
npm install ../krdpass-auth-sdk/packages/krdpass_auth_react_native
```

This package runs a `prepare` build on install. If npm scripts are disabled, run once:

```bash
cd ../krdpass-auth-sdk/packages/krdpass_auth_react_native
npm run build
```

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

- Path: `packages/krdpass_auth_react_native/example`
- Setup guide: `packages/krdpass_auth_react_native/example/README.md`

## Security Notes

- Keep `client_secret` and private keys server-side.
- Never commit secrets, keystores, or `.env` files.

## Related Docs

- Root guide: `../../README.md`
- Integration architecture: `../../docs/INTEGRATION.md`
- Server reference: `../../examples/server/README.md`

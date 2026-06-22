# KRDPASS React Native Example App

Reference Expo app for **Sign in with KRDPASS**. The SDK package supports both Expo and bare React Native apps.

## What This Example Demonstrates

- Server-mediated PAR + PKCE flow
- Citizen identity retrieval
- Token verification
- Refresh and revoke endpoints (when approved)

## Prerequisites

- Node.js 18+
- Expo CLI tooling
- iOS/Android native toolchains for `expo run:*`
- Running backend (recommended: `examples/server`)

## Required Onboarding Inputs

- `CLIENT_ID`
- HTTPS `REDIRECT_URI`
- `BACKEND_URL`
- Approved scopes (include `offline_access` only when approved)
- iOS associated domain host
- Android package name + signing SHA-256 fingerprint

## Step-by-Step Setup

1. Install dependencies:

```bash
npm install
```

2. Configure demo values from template:

```bash
cp .env.example .env
```

Set values in `.env`:

```ini
EXPO_PUBLIC_BACKEND_URL=https://api.your-backend.example.com
EXPO_PUBLIC_REDIRECT_URI=https://auth.your-app.example.com/_krdpass/oauth/callback
EXPO_PUBLIC_CLIENT_ID=your-client-id
EXPO_PUBLIC_KRD_ENVIRONMENT=development
```

These values are read by `config.ts`.

3. Configure iOS Universal Link host in `app.json`:
- `expo.ios.associatedDomains` should include `applinks:<your-app-universal-link-host>`.

4. Optional custom Android signing:

```bash
cp android/key.properties.example android/key.properties
```

If `android/key.properties` is missing, debug builds use default debug signing.

5. Run app:

```bash
npx expo run:android
# or
npx expo run:ios
```

For iOS physical devices, start Metro for dev-client in a separate terminal:

```bash
npx expo start --dev-client --tunnel
```

## Notes

- Keep `client_secret` and private keys on backend only.
- Set `EXPO_PUBLIC_REDIRECT_URI` to your app's Universal Link host (not a generic backend placeholder).
- Use HTTPS redirect URI registered during onboarding.
- Android callback returns through Intent result while OAuth policy still requires `redirectUri`.

## Related Docs

- SDK README: `../README.md`
- Integration guide: `../../../docs/INTEGRATION.md`
- Server reference: `../../../examples/server/README.md`

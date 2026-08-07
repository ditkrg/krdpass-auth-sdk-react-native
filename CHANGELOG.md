# Changelog

## [1.4.0] - 2026-08-07

- `KrdpassUserInfo` gained `upns`, the citizen's historical UPNs as a string array. Empty when
  the claim is absent.
- iOS cancellations now carry the provider's own description on `rawDescription`, matching
  Android. Previously the iOS bridge discarded it and always reported the canonical cancelled
  message.

## [1.3.0] - 2026-07-29

Initial public release.

- App-to-app sign-in with the KRDPASS identity app, wrapping the native Android and iOS
  cores. Not a browser or WebView flow.
- One package for Expo development builds and bare React Native, through a Codegen
  TurboModule and standard autolinking. Expo Go is not supported.
- Two flows: client-only (`signIn`, the SDK runs PKCE, PAR and token exchange) and
  server-mediated (`authenticate`, your backend does).
- ID-token verification against JWKS, plus refresh, revoke and userinfo helpers.
- Results are accepted only from the exact registered redirect endpoint. `signIn`,
  `getUserInfo`, `refreshTokens`, `revokeToken`, `verifyToken` and `generatePkcePair` reject
  with a typed `KrdpassAuthError`; `authenticate` resolves with a typed `AuthResult`. Both
  carry the lowercase error codes shared with the Android, iOS and Flutter SDKs, and keep the
  original CAS or native text on `rawDescription`.

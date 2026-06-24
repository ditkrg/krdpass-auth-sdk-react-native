# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-28

### Changed (cross-SDK uniformity)

- `getUserInfo()` now returns a typed `KrdpassUserInfo` (mapped camelCase claims +
  `citizenFullName` + `raw`), matching the Android/Flutter SDKs.
- Error-code set aligned across platforms: added `network_error` and `access_denied`
  to `AuthErrorCode`; `isAuthResultCancelled()` now also treats `access_denied` as a
  cancellation.
- Removed `krd.pass.staging` from the Expo config plugin and docs (no staging
  environment exists in the SDK).

### Added

- Initial release of krdpass-auth-react-native
- **Setup**
  - `initialize()` - Store clientId/redirectUri/environment as global defaults
- **Authentication Methods**
  - `signIn()` - Client-only OAuth/PAR authentication (resolves with tokens on
    success; throws a `KrdpassAuthError` on cancel/failure, consistently across
    Android and iOS)
  - `authenticate()` - Server-mediated authentication flow
  - `buildAuthorizationUrl()` - Build the authorize URL for server-mediated flows
  - `cancelPendingAuthentication()` - Cancel an in-flight authentication attempt
- **PKCE Support**
  - `generatePkcePair()` - Generate code verifier and challenge
  - `generateState()` - Generate OAuth state parameter
- **Token Management**
  - `refreshTokens()` - Refresh access tokens
  - `revokeToken()` - Revoke access or refresh tokens
  - `verifyToken()` - Verify ID token signature using JWKS
  - `decodeTokenUnverified()` - Decode JWT without verification
- **User Info**
  - `getUserInfo()` - Fetch user claims from userinfo endpoint
- **TypeScript Support**
  - Exported interfaces for all config types, plus the `KrdpassAuthError` class
  - Full JSDoc documentation
- **Platform Support**
  - Android via Expo Modules
  - iOS via Expo Modules (requires iOS 15.5+)
  - Expo-version-agnostic: Expo/`expo-modules-core` are peer dependencies, so the
    SDK installs cleanly across Expo SDK versions
- **Example App**
  - Complete demo app demonstrating all SDK features
  - Dark mode support
  - Both client-only and server-mediated flows

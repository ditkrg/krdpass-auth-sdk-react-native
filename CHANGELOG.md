# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1]

### Security

- Bumps the native iOS and Android SDKs to 1.0.1, which enforce strict OAuth
  `state` validation on authorization error responses.

## [1.0.0]

### Added

- Initial release of krdpass-auth-react-native
- **Setup**
  - `initialize()` - Store clientId/redirectUri/environment as global defaults, reused
    by every call (`signIn`/`authenticate`/`getUserInfo`/`verifyToken`/etc. take no
    per-call overrides), matching the Android/Flutter SDKs
- **Authentication Methods**
  - `signIn()` - Client-only OAuth/PAR authentication (resolves with tokens on
    success; throws a `KrdpassAuthError` on cancel/failure, consistently across
    Android and iOS). The sign-in window is bounded by the PAR `request_uri` lifetime.
  - `authenticate()` - Server-mediated authentication flow
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
  - `getUserInfo()` - Fetch user claims from userinfo endpoint, returned as a typed
    `KrdpassUserInfo` (mapped camelCase claims + `citizenFullName` + `raw`), matching
    the Android/Flutter SDKs
- **TypeScript Support**
  - Exported interfaces for all config types, plus the `KrdpassAuthError` class
  - Error codes aligned across platforms, including `network_error` and
    `access_denied` (the latter classified as a cancellation by
    `isAuthResultCancelled()`)
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

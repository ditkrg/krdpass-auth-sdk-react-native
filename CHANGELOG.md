# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-28

### Added

- Initial release of krdpass-auth-react-native
- **Authentication Methods**
  - `signIn()` - Client-only OAuth/PAR authentication
  - `authenticate()` - Server-mediated authentication flow
- **PKCE Support**
  - `generatePkcePair()` - Generate code verifier and challenge
  - `generateState()` - Generate OAuth state parameter
- **Token Management**
  - `refreshTokens()` - Refresh access tokens
  - `revokeToken()` - Revoke access or refresh tokens
  - `verifyToken()` - Verify ID token signature using JWKS
  - `decodeToken()` - Decode JWT without verification
- **User Info**
  - `getUserInfo()` - Fetch user claims from userinfo endpoint
- **TypeScript Support**
  - Exported interfaces for all config types
  - Full JSDoc documentation
- **Platform Support**
  - Android via Expo Modules
  - iOS via Expo Modules (requires iOS 15.5+)
- **Example App**
  - Complete demo app demonstrating all SDK features
  - Dark mode support
  - Both client-only and server-mediated flows

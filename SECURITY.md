# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.5.x   | yes                |

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Email **security@pass.krd** instead, and include:

1. **Description**: a clear description of the vulnerability
2. **Steps to reproduce**: detailed steps to reproduce the issue
3. **Impact**: what an attacker could achieve by exploiting it
4. **Environment**: SDK name/version, platform version, device information
5. **Proof of concept**: if possible

### Our commitment

- We will acknowledge receipt of your report within 48 hours.
- We will provide a more detailed response within 7 days indicating our next steps.
- We will keep you informed about our progress throughout the process.
- We will credit you (with your permission) when the vulnerability is disclosed.

## Notes on two deliberate choices

**Nothing here pins the TLS certificate of `account.id.krd`.** This package opens no
sockets of its own. Every network call it can cause, the token exchange and the JWKS
fetch included, is made by the KRDPASS Android or iOS SDK on the far side of the native
module, so the choice described below is the native SDKs' and this package only inherits
it.

The choice is deliberate. A certificate pin ships inside your app and then outlives every
release you are able to push: once the pinned certificate is replaced, every installed
copy that has not taken your update stops being able to sign in, and no server-side change
can rescue it. That offline failure mode buys very little here, because the leg worth
attacking never crosses a network. The authorization request is handed app to app by the
platform: on Android through a `setPackage()`-locked explicit Intent to a package whose APK
signing certificate the native SDK pins, and on iOS through a universal link opened with
`universalLinksOnly: true`, which reaches only an app Apple has verified owns the domain.
The HTTPS calls that remain are validated against the platform trust store.

**Tokens are not redacted in this SDK's result types, and things read them for you.**
The results are plain TypeScript interfaces with no custom `toString`, so
`console.log(tokens)` prints the raw access token. That much is structural and no change
to the types can hide it. The part that catches people is automatic capture: Sentry's
React Native SDK installs `console` and XHR breadcrumbs by default, Flipper records log
and network traffic in debug builds, and a redbox serializes the values in scope into its
payload. Any of those can carry a live token off the device without anyone having written
a log line. Redact at the call site, and add your token fields to the crash reporter's
scrubbing list (`beforeBreadcrumb` and `beforeSend` in Sentry) rather than trusting that
nobody logged them.

## Full Security Policy

The complete KRDPASS security policy, including the security model for the
app-to-app authorization flow and redirect validation, is maintained in the
samples repository:
[`docs/SECURITY.md`](https://github.com/ditkrg/krdpass-auth-samples/blob/main/docs/SECURITY.md).

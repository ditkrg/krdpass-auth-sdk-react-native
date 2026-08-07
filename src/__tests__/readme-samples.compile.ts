// Compile-only guard for the code samples in README.md. `npm run typecheck` is the
// assertion: if an example stops matching the public API, tsc fails.
//
// The root tsconfig excludes __tests__ so this is never emitted into build/, which also
// means the default `tsc` run never sees it. tsconfig.guard.json is what compiles this
// file, and `npm run typecheck` runs both projects.
//
// Not named *.test.ts: jest would try to execute it, and importing the package root pulls
// in react-native, which jest does not transform. Nothing here needs to run, only compile.
// It lives under __tests__ so it stays out of the published tarball.
import {
  initialize,
  signIn,
  authenticate,
  getUserInfo,
  makeTokenResult,
  KrdpassAuthError,
  isAuthResultSuccess,
  isAuthResultCancelled,
  isAuthResultTimeout,
  isAuthResultBusy,
  isAuthResultProviderNotInstalled,
} from "../index";

export function quickstartInitialize(): void {
  initialize({
    clientId: "your-client-id",
    redirectUri: "https://auth.your-app.example.com/_krdpass/oauth/callback",
    environment: "production", // or 'development'
  });
}

export async function quickstartClientOnly(): Promise<void> {
  try {
    const tokens = await signIn({ scopes: ["openid", "profile"] });
    const user = await getUserInfo({ accessToken: tokens.accessToken });
    void user;
  } catch (e) {
    if (e instanceof KrdpassAuthError) {
      switch (e.code) {
        case "cancelled":
        case "access_denied":
          break; // usually no UI needed
        case "timeout":
          break; // offer retry
        case "busy":
          break; // ignore or queue
        case "state_mismatch":
          break; // fail closed and restart
        case "provider_not_installed":
          break; // e.installUrl is set, open it
        default:
          console.error(e.code, e.errorDescription);
      }
    }
  }
}

declare function fetchParFromYourBackend(): Promise<{
  requestUri: string;
  state: string;
}>;

export async function quickstartServerMediated(): Promise<void> {
  const par = await fetchParFromYourBackend(); // { requestUri, state }
  const result = await authenticate({
    requestUri: par.requestUri,
    state: par.state,
  });
  if (isAuthResultSuccess(result)) {
    void result.code;
    void result.state;
  } else if (isAuthResultCancelled(result)) {
    // usually no UI needed
  } else if (isAuthResultTimeout(result)) {
    // offer retry
  } else if (isAuthResultBusy(result)) {
    // ignore or queue
  } else if (isAuthResultProviderNotInstalled(result)) {
    void result.installUrl;
  } else {
    void result.error;
    void result.errorDescription;
  }
}

// The README tells you to wrap your backend's token JSON with makeTokenResult rather than
// casting it. That only type-checks once the JSON is parsed into the token shape, which is
// the point: a bare `Record<string, unknown>` is exactly what a cast would have hidden.
export function quickstartMakeTokenResult(json: {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
  idToken?: string;
  refreshToken?: string;
  scope?: string;
}): void {
  const tokens = makeTokenResult(json);
  void tokens.isExpired();
}

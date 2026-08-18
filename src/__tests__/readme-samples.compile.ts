// Compile-only guard for the code samples in README.md: if an example stops matching the
// public API, `npm run typecheck` fails (tsconfig.guard.json compiles this file; the root
// tsconfig excludes __tests__). Not named *.test.ts because jest would try to execute it,
// and importing the package root pulls in react-native, which jest does not transform.
import {
  initialize,
  signIn,
  authenticate,
  cancelPendingAuthentication,
  getUserInfo,
  makeTokenResult,
  KrdpassAuthError,
  KrdpassScopes,
  isAuthResultError,
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
          break;
        case "timeout":
          break;
        case "busy":
          break;
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
    void result;
  } else if (isAuthResultTimeout(result)) {
    void result;
  } else if (isAuthResultBusy(result)) {
    void result;
  } else if (isAuthResultProviderNotInstalled(result)) {
    void result.installUrl;
  } else {
    void result.error;
    void result.errorDescription;
  }
}

export async function quickstartRestOfTheSurface(): Promise<void> {
  const tokens = await signIn({
    scopes: [KrdpassScopes.openid, KrdpassScopes.citizen_identity],
  });
  void tokens.accessToken;

  const wasPending = await cancelPendingAuthentication();
  void wasPending;

  const par = await fetchParFromYourBackend();
  const result = await authenticate({
    requestUri: par.requestUri,
    state: par.state,
  });
  if (isAuthResultError(result)) {
    console.error(result.error, result.errorDescription);
  }
}

// The README says to wrap backend token JSON with makeTokenResult rather than casting it;
// that only type-checks once the JSON is parsed into the token shape, which is the point.
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

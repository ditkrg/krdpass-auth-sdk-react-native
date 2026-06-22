/**
 * AuthBackendService - Handles backend-mediated OAuth flows for Server Mode
 * 
 * This service mirrors the Flutter AuthBackendService and communicates with
 * a backend server that handles PAR and token exchange on behalf of the client.
 */
import type { KrdpassEnvironment } from 'krdpass-auth-react-native';


import { BACKEND_URL } from '../config';

export interface ParResponse {
  requestUri: string;
  expiresIn?: number;
  state?: string;
}

export interface TokenResult {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
}

export class AuthBackendService {
  /**
   * Request a PAR URI from the backend.
   * The backend will forward this to the OIDC provider and return the requestUri.
   */
  static async getRequestUri(params: {
    codeChallenge: string;
    state?: string;
    nonce?: string;
    environment: KrdpassEnvironment;
    redirectUri: string;
    scope?: string;
  }): Promise<ParResponse> {
    const environment = params.environment;
    const body = {
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: 'S256',
      environment,
      redirectUri: params.redirectUri,
      ...(params.state && { state: params.state }),
      ...(params.nonce && { nonce: params.nonce }),
      ...(params.scope && { scope: params.scope }),
    };

    const response = await fetch(`${BACKEND_URL}/oauth/par`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`PAR request failed: ${response.status}\n${text}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`PAR request failed: ${data.error}`);
    }

    return {
      requestUri: data.requestUri,
      expiresIn: data.expiresIn,
      state: data.state,
    };
  }

  /**
   * Exchange authorization code for tokens via the backend.
   * The backend will handle the token exchange with the OIDC provider.
   */
  static async exchangeToken(params: {
    code: string;
    state: string;
    codeVerifier: string;
    environment: KrdpassEnvironment;
    redirectUri: string;
  }): Promise<TokenResult> {
    const environment = params.environment;
    const response = await fetch(`${BACKEND_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: params.code,
        state: params.state,
        codeVerifier: params.codeVerifier,
        environment,
        redirectUri: params.redirectUri,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Backend request failed: ${response.status} - ${errorBody}`);
    }

    return await response.json();
  }

  /**
   * Refresh tokens via the backend.
   */
  static async refreshToken(params: {
    refreshToken: string;
    environment: KrdpassEnvironment;
    scope?: string;
  }): Promise<TokenResult> {
    const environment = params.environment;
    const body = {
      refreshToken: params.refreshToken,
      environment,
      ...(params.scope && { scope: params.scope }),
    };

    const response = await fetch(`${BACKEND_URL}/oauth/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Backend request failed: ${response.status} - ${errorBody}`);
    }

    return await response.json();
  }

  /**
   * Revoke a token via the backend.
   */
  static async revokeToken(params: {
    token: string;
    environment: KrdpassEnvironment;
    tokenTypeHint?: string;
  }): Promise<void> {
    const environment = params.environment;
    const body = {
      token: params.token,
      environment,
      tokenTypeHint: params.tokenTypeHint ?? 'access_token',
    };

    const response = await fetch(`${BACKEND_URL}/oauth/token/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Backend request failed: ${response.status} - ${errorBody}`);
    }
  }
}

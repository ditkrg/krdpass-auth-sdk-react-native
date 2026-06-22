import type { KrdpassEnvironment } from 'krdpass-auth-react-native';

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        'Copy .env.example to .env and fill in your values.',
    );
  }
  return value;
}

export const BACKEND_URL = trimTrailingSlashes(
  requireEnv('EXPO_PUBLIC_BACKEND_URL'),
);

export const CLIENT_ID = requireEnv('EXPO_PUBLIC_CLIENT_ID');

export const REDIRECT_URI =
  process.env.EXPO_PUBLIC_REDIRECT_URI?.trim() ||
  `${BACKEND_URL}/_krdpass/oauth/callback`;

export const ENVIRONMENT: KrdpassEnvironment =
  (process.env.EXPO_PUBLIC_KRD_ENVIRONMENT as KrdpassEnvironment) ??
  'development';

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COGNITO_USER_POOL_ID: string;
  readonly VITE_COGNITO_USER_POOL_WEB_CLIENT_ID: string;
  readonly VITE_API_ENDPOINT: string;
  readonly VITE_COGNITO_REDIRECT_SIGNIN: string;
  readonly VITE_COGNITO_REDIRECT_SIGNOUT: string;
  readonly VITE_COGNITO_OAUTH_DOMAIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

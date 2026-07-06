import { OpenAPI } from '@defuse-protocol/one-click-sdk-typescript';

export interface OneClickApiConfig {
  baseUrl: string;
  token?: string;
}

export interface OneClickApiAuthOptions {
  userToken?: string;
}

const defaultOneClickBaseUrl = 'https://1click.chaindefuser.com';

export function getOneClickApiConfig(): OneClickApiConfig {
  return {
    baseUrl: process.env.ONE_CLICK_BASE_URL || defaultOneClickBaseUrl,
    token: process.env.PARTNER_JWT || undefined,
  };
}

export function getRequiredOneClickApiConfig(): OneClickApiConfig & { token: string } {
  const config = getOneClickApiConfig();
  if (!config.token) {
    throw new Error('PARTNER_JWT is required for 1Click API requests');
  }
  return { ...config, token: config.token };
}

export function configureOneClickApi(config: OneClickApiConfig, auth: OneClickApiAuthOptions = {}): void {
  OpenAPI.BASE = config.baseUrl;
  OpenAPI.TOKEN = auth.userToken ?? config.token;
  OpenAPI.HEADERS =
    auth.userToken && config.token
      ? {
          'x-api-key': config.token,
        }
      : undefined;
}

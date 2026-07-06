import { keyStores } from 'near-api-js';
import { NearChainId, INearAccountConfig, INearConnectionConfig } from '../interfaces/near.interface';

export const nearNetworkId = (process.env.NEAR_NETWORK_ID as NearChainId) || NearChainId.MAINNET;

export function parseNearNodeHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`NEAR_NODE_HEADERS is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('NEAR_NODE_HEADERS must be a JSON object');
  }

  if (!Object.values(parsed).every((headerValue) => typeof headerValue === 'string')) {
    throw new Error('NEAR_NODE_HEADERS values must all be strings');
  }

  return parsed as Record<string, string>;
}

export const nearDefaultConnectionConfigs = {
  [NearChainId.MAINNET]: {
    networkId: NearChainId.MAINNET,
    nodeUrls: ['https://free.rpc.fastnear.com', 'https://near.lava.build'],
    walletUrl: 'https://wallet.mainnet.near.org',
    helperUrl: 'https://helper.mainnet.near.org',
    keyStore: new keyStores.InMemoryKeyStore(),
  },
  [NearChainId.TESTNET]: {
    networkId: NearChainId.TESTNET,
    nodeUrls: ['https://test.rpc.fastnear.com', 'https://neart.lava.build'],
    walletUrl: 'https://wallet.testnet.near.org',
    helperUrl: 'https://helper.testnet.near.org',
    keyStore: new keyStores.InMemoryKeyStore(),
  },
};

const urlEnv = process.env.NEAR_NODE_URLS || process.env.NEAR_NODE_URL;
const headers = parseNearNodeHeaders(process.env.NEAR_NODE_HEADERS);
export const nodeUrls = urlEnv
  ? urlEnv.split(',').map((url) => url.trim())
  : nearDefaultConnectionConfigs[nearNetworkId].nodeUrls;

export const nearConnectionConfigs: INearConnectionConfig[] = nodeUrls.map((nodeUrl) => ({
  ...nearDefaultConnectionConfigs[nearNetworkId],
  nodeUrl,
  headers,
})) as INearConnectionConfig[];

export const nearAccountConfig: INearAccountConfig = {
  accountId: process.env.NEAR_ACCOUNT_ID!,
  privateKey: process.env.NEAR_PRIVATE_KEY!,
};

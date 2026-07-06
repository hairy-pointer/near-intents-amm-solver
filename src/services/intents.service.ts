import { randomBytes, createHash } from 'crypto';
import { createIntentSignerNEP413, IntentsSDK, VersionedNonceBuilder } from '@defuse-protocol/intents-sdk';
import { AccountService, UserAuthService, type MultiPayload } from '@defuse-protocol/one-click-sdk-typescript';
import { intentsContract } from '../configs/intents.config';
import { privateIntentsContractSalt } from '../configs/private-intents.config';
import { isConfidentialMode } from '../configs/solver-mode.config';
import {
  configureOneClickApi,
  getRequiredOneClickApiConfig,
  type OneClickApiConfig,
} from '../configs/one-click.config';
import { NearService } from './near.service';
import { publicAssetIdentifier } from '../utils/private-assets';

type OneClickUserToken = {
  accessToken: string;
  expiresAtMs: number;
};

const authTokenRefreshSkewMs = 60_000;
const oneClickAuthIntentTtlMs = 5 * 60_000;
const oneClickAuthReferral = 'near-intents-amm-solver';

export class IntentsService {
  private oneClickUserToken?: OneClickUserToken;

  public constructor(private readonly nearService: NearService) {}

  public generateRandomNonce() {
    const randomArray = randomBytes(32);
    return randomArray.toString('base64');
  }

  public generateDeterministicNonce(input: string) {
    const hash = createHash('sha256');
    hash.update(input);
    return hash.digest('base64');
  }

  public generateVersionedNonce(deadline: Date) {
    const salt = this.parsePrivateIntentsContractSalt();
    return VersionedNonceBuilder.encodeNonce(salt, deadline);
  }

  public async getBalances(tokenIds: string[]) {
    if (isConfidentialMode) {
      return this.getBalancesFromOneClick(tokenIds);
    }

    return this.getBalancesOnContract(tokenIds);
  }

  private async getBalancesOnContract(tokenIds: string[]) {
    const account = this.nearService.getAccount();
    const result = await account.viewFunction({
      contractId: intentsContract,
      methodName: 'mt_batch_balance_of',
      args: {
        account_id: this.nearService.getIntentsAccountId(),
        token_ids: tokenIds,
      },
    });
    const balances = result as string[];
    if (balances?.length !== tokenIds.length) {
      throw new Error(`Expected to receive ${tokenIds.length} balances, but got ${balances?.length}`);
    }
    return balances;
  }

  private async getBalancesFromOneClick(tokenIds: string[]) {
    const config = getRequiredOneClickApiConfig();
    const userToken = await this.getOneClickUserToken(config);
    configureOneClickApi(config, { userToken });

    const response = await AccountService.getBalances(tokenIds);
    const balancesByTokenId = new Map(response.balances.map(({ tokenId, available }) => [tokenId, available]));

    return tokenIds.map((tokenId) => {
      return balancesByTokenId.get(tokenId) ?? balancesByTokenId.get(publicAssetIdentifier(tokenId)) ?? '0';
    });
  }

  private async getOneClickUserToken(config: OneClickApiConfig & { token: string }) {
    if (this.oneClickUserToken && this.oneClickUserToken.expiresAtMs > Date.now()) {
      return this.oneClickUserToken.accessToken;
    }

    configureOneClickApi(config);
    const signer = createIntentSignerNEP413({
      accountId: this.nearService.getIntentsAccountId(),
      signMessage: async (_nep413Payload, nep413Hash) => {
        const signature = await this.nearService.signMessage(nep413Hash);
        return {
          publicKey: signature.publicKey.toString(),
          signature: Buffer.from(signature.signature).toString('base64'),
        };
      },
    });

    const now = Date.now();
    const sdk = new IntentsSDK({
      referral: oneClickAuthReferral,
      env: this.getOneClickAuthEnv(config),
    });
    const { signed } = await sdk
      .intentBuilder()
      .setDeadline(new Date(now + oneClickAuthIntentTtlMs))
      .setNonceRandomBytes(VersionedNonceBuilder.createTimestampedNonceBytes(new Date(now)))
      .buildAndSign(signer);
    const auth = await UserAuthService.authenticate({ signedData: signed as unknown as MultiPayload });

    this.oneClickUserToken = {
      accessToken: auth.accessToken,
      expiresAtMs: Date.now() + auth.expiresIn * 1000 - authTokenRefreshSkewMs,
    };

    return this.oneClickUserToken.accessToken;
  }

  private getOneClickAuthEnv(config: OneClickApiConfig) {
    try {
      return new URL(config.baseUrl).hostname === '1click.chaindefuser.com' ? 'production' : 'stage';
    } catch {
      return 'stage';
    }
  }

  private parsePrivateIntentsContractSalt() {
    const saltHex = privateIntentsContractSalt.trim();
    const salt = Buffer.from(saltHex, 'hex');
    if (salt.length !== 4 || salt.toString('hex') !== saltHex.toLowerCase()) {
      throw new Error(`PRIVATE_INTENTS_CONTRACT_SALT must be a 4-byte hex string`);
    }

    return salt;
  }

  private async isNonceUsed(nonce: string) {
    const account = this.nearService.getAccount();
    return await account.viewFunction({
      contractId: intentsContract,
      methodName: 'is_nonce_used',
      args: {
        account_id: this.nearService.getIntentsAccountId(),
        nonce,
      },
    });
  }
}

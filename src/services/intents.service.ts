import { randomBytes, createHash } from 'crypto';
import { intentsContract } from '../configs/intents.config';
import { NearService } from './near.service';
import { tokens } from 'src/configs/tokens.config';

export class IntentsService {
  public constructor(private readonly nearService: NearService) {}

  public async init(): Promise<void> {
    if (!intentsContract) {
      throw new Error('Invalid intents contract');
    }

    // Verify reserves on NEAR Intents contract
    try {
      const reserves = await this.getBalancesOnContract(tokens);
      if (reserves.length !== tokens.length) {
        throw new Error(
          `Invalid number of reserves on NEAR Intents contract ${intentsContract}: Expected: ${tokens.length}, Received: ${reserves.length}`,
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to validate reserves on NEAR Intents contract ${intentsContract}. ${errorMessage}`);
    }
  }

  public generateRandomNonce() {
    const randomArray = randomBytes(32);
    return randomArray.toString('base64');
  }

  public generateDeterministicNonce(input: string) {
    const hash = createHash('sha256');
    hash.update(input);
    return hash.digest('base64');
  }

  public async getBalancesOnContract(tokenIds: string[]) {
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

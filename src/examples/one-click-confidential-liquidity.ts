import { KeyPair } from 'near-api-js';
import { createIntentSignerNearKeyPair } from '@defuse-protocol/intents-sdk';
import {
  GenerateSwapTransferIntentRequest,
  GetExecutionStatusResponse,
  IntentStandardEnum,
  OneClickService,
  QuoteRequest,
  SubmitSwapTransferIntentRequest,
  type MultiPayload,
  type MultiPayloadNarrowed,
  type QuoteResponse,
} from '@defuse-protocol/one-click-sdk-typescript';
import {
  getOneClickConfidentialLiquidityConfig,
  type OneClickConfidentialLiquidityConfig,
} from '../configs/one-click-confidential-liquidity.config';
import { configureOneClickApi } from '../configs/one-click.config';
import { loadEnv } from '../utils/load-env';

/**
 * Runnable example for moving the same asset between public Intents and
 * confidential Intents through 1Click.
 */
type Direction = 'deposit' | 'withdraw';

type GenerateIntentResponse = {
  intent: MultiPayloadNarrowed;
  correlationId: string;
};

type SubmitIntentResponse = {
  intentHash: string;
  correlationId: string;
};

const terminalStatuses = new Set<string>([
  GetExecutionStatusResponse.status.SUCCESS,
  GetExecutionStatusResponse.status.REFUNDED,
  GetExecutionStatusResponse.status.FAILED,
]);

function deadline(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

function parseDirection(): Direction {
  const direction = process.argv[2];
  if (direction === 'deposit' || direction === 'withdraw') {
    return direction;
  }

  throw new Error('Expected direction argument: deposit or withdraw');
}

function buildQuoteRequest(direction: Direction, config: OneClickConfidentialLiquidityConfig): QuoteRequest {
  const endpointTypes =
    direction === 'deposit'
      ? {
          depositType: QuoteRequest.depositType.INTENTS,
          recipientType: QuoteRequest.recipientType.CONFIDENTIAL_INTENTS,
          refundType: QuoteRequest.refundType.INTENTS,
        }
      : {
          depositType: QuoteRequest.depositType.CONFIDENTIAL_INTENTS,
          recipientType: QuoteRequest.recipientType.INTENTS,
          refundType: QuoteRequest.refundType.CONFIDENTIAL_INTENTS,
        };

  return {
    dry: false,
    swapType: QuoteRequest.swapType.EXACT_INPUT,
    slippageTolerance: config.slippageTolerance,
    originAsset: config.assetId,
    destinationAsset: config.assetId,
    amount: config.amount,
    refundTo: config.accountId,
    recipient: config.accountId,
    deadline: deadline(config.deadlineMinutes),
    quoteWaitingTimeMs: config.quoteWaitingTimeMs,
    ...endpointTypes,
  };
}

function assertDepositAddress(quoteResponse: QuoteResponse): string {
  const depositAddress = quoteResponse.quote.depositAddress;
  if (!depositAddress) {
    throw new Error('1Click quote response does not include a depositAddress');
  }
  return depositAddress;
}

async function signNep413(
  intent: MultiPayloadNarrowed,
  config: OneClickConfidentialLiquidityConfig,
): Promise<MultiPayload> {
  if (intent.standard !== IntentStandardEnum.NEP413) {
    throw new Error(`Expected NEP-413 intent, got ${intent.standard}`);
  }

  const intentSigner = createIntentSignerNearKeyPair({
    accountId: config.accountId,
    signer: KeyPair.fromString(config.privateKey),
  });

  return (await intentSigner.signRaw({ payload: intent.payload })) as unknown as MultiPayload;
}

async function oneClickPost<TResponse>(
  path: string,
  body: unknown,
  config: OneClickConfidentialLiquidityConfig,
): Promise<TResponse> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${config.token}`,
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`1Click ${path} failed with HTTP ${response.status}: ${responseText}`);
  }

  return JSON.parse(responseText) as TResponse;
}

async function generateIntent(
  request: GenerateSwapTransferIntentRequest,
  config: OneClickConfidentialLiquidityConfig,
): Promise<GenerateIntentResponse> {
  return oneClickPost<GenerateIntentResponse>('/v0/generate-intent', request, config);
}

async function submitIntent(
  signedData: MultiPayload,
  config: OneClickConfidentialLiquidityConfig,
): Promise<SubmitIntentResponse> {
  return oneClickPost<SubmitIntentResponse>(
    '/v0/submit-intent',
    {
      type: SubmitSwapTransferIntentRequest.type.SWAP_TRANSFER,
      signedData,
    } satisfies SubmitSwapTransferIntentRequest,
    config,
  );
}

async function waitForExecutionStatus(
  depositAddress: string,
  config: OneClickConfidentialLiquidityConfig,
  depositMemo?: string,
) {
  for (let attempt = 1; attempt <= config.statusAttempts; attempt += 1) {
    const status = await OneClickService.getExecutionStatus(depositAddress, depositMemo);
    console.log(`status attempt ${attempt}/${config.statusAttempts}: ${status.status}`);

    if (terminalStatuses.has(status.status)) {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, config.statusDelayMs));
  }

  throw new Error(`Execution did not reach a terminal status after ${config.statusAttempts} attempts`);
}

async function run(): Promise<void> {
  loadEnv();

  const config = getOneClickConfidentialLiquidityConfig();
  const direction = parseDirection();
  configureOneClickApi(config);

  const quoteRequest = buildQuoteRequest(direction, config);
  console.log(`requesting ${direction} quote for ${quoteRequest.amount} ${quoteRequest.originAsset}`);

  const quoteResponse = await OneClickService.getQuote(quoteRequest);
  const depositAddress = assertDepositAddress(quoteResponse);
  console.log(`quote correlationId: ${quoteResponse.correlationId}`);
  console.log(`depositAddress: ${depositAddress}`);
  if (quoteResponse.quote.depositMemo) {
    console.log(`depositMemo: ${quoteResponse.quote.depositMemo}`);
  }
  console.log(`amountIn: ${quoteResponse.quote.amountIn}`);
  console.log(`amountOut: ${quoteResponse.quote.amountOut}`);

  const generated = await generateIntent(
    {
      type: GenerateSwapTransferIntentRequest.type.SWAP_TRANSFER,
      standard: IntentStandardEnum.NEP413,
      signerId: config.accountId,
      depositAddress,
    },
    config,
  );
  console.log(`generateIntent correlationId: ${generated.correlationId}`);

  const signedData = await signNep413(generated.intent, config);
  const submitted = await submitIntent(signedData, config);
  if (!submitted.intentHash) {
    throw new Error('1Click submitIntent response does not include an intentHash');
  }
  console.log(`submitIntent correlationId: ${submitted.correlationId}`);
  console.log(`intentHash: ${submitted.intentHash}`);

  const status = await waitForExecutionStatus(depositAddress, config, quoteResponse.quote.depositMemo);
  console.log(`final status: ${status.status}`);
  console.log(`intent hashes: ${status.swapDetails.intentHashes.join(', ') || 'none'}`);
  console.log(`near tx hashes: ${status.swapDetails.nearTxHashes.join(', ') || 'none'}`);
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import {
  type Connection,
  type Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import "dotenv/config";

import { executeJupUltraOrder, getJupUltraOrder } from "./jup-utils";
import {
  SOL_MINT,
  SOLANA_NEAR_ID,
  USDC_MINT,
  ZCASH_DECIMALS,
  ZEC_MINT,
  ZEC_NEAR_ID,
  ZENZEC_MINT,
} from "./const";

type QuoteResponse = {
  quote: {
    amountIn: string;
    amountInFormatted: string;
    amountInUsd: string;
    minAmountIn: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    minAmountOut: string;
    timeEstimate: number;
    deadline: string;
    timeWhenInactive: string;
    depositAddress: string;
  };
  quoteRequest: {
    dry: boolean;
    depositMode: string;
    swapType: string;
    slippageTolerance: number;
    originAsset: string;
    depositType: string;
    destinationAsset: string;
    amount: string;
    refundTo: string;
    refundType: string;
    recipient: string;
    connectedWallets: string[];
    sessionId: string;
    recipientType: string;
    deadline: string;
    referral: string;
    quoteWaitingTimeMs: number;
    appFees: {
      recipient: string;
      fee: number;
    }[];
  };
  signature: string;
  timestamp: string;
};

// https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api#post-v0-quote

export async function swapZenZec(connection: Connection, usdcAmount: string, user: Keypair) {
  const jupUltraOrderSol = await getJupUltraOrder(
    new PublicKey(USDC_MINT),
    new PublicKey(SOL_MINT),
    Number(usdcAmount),
    user.publicKey,
    100,
  );

  await executeJupUltraOrder(jupUltraOrderSol.transaction, jupUltraOrderSol.requestId, user);

  const response = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dry: false,
      depositMode: "SIMPLE",
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: SOLANA_NEAR_ID,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: ZEC_NEAR_ID,
      amount: jupUltraOrderSol.outAmount,
      refundTo: user.publicKey,
      refundType: "ORIGIN_CHAIN",
      recipient: user.publicKey,
      connectedWallets: [user.publicKey],
      sessionId: "pavs_test",
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 30000), // 30s -> Refund to user wallet if swap not done by then
      quoteWaitingTimeMs: 0,
      // appFees: [
      // 	{
      // 		recipient: "recipient.near",
      // 		fee: 100,
      // 	},
      // ],
    }),
  });

  console.log(response);
  if (!response.ok) {
    const t = await response.text();
    console.log(t);
    throw new Error(`Error obtainign quote: ${t}`);
  }
  const data = (await response.json()) as QuoteResponse;

  const blockhash = await connection.getLatestBlockhash();

  const transaction = new Transaction({
    ...blockhash,
  });

  // Send required amount to destination address
  const ix = SystemProgram.transfer({
    fromPubkey: user.publicKey,
    toPubkey: new PublicKey(data.quote.depositAddress),
    lamports: BigInt(jupUltraOrderSol.outAmount),
  });

  transaction.add(ix);
  transaction.sign(user);

  const signature = await connection.sendTransaction(transaction, [user]);

  await connection.confirmTransaction(signature, "finalized");

  let depositSubmitData: any;

  const depositTimeout = 30000;
  let start = 0;
  while (start < depositTimeout) {
    const startFetch = Date.now();
    const nearDepositSubmitResponse = await fetch(
      "https://1click.chaindefuser.com/v0/deposit/submit",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          txHash: signature,
          depositAddress: data.quote.depositAddress,
        }),
      },
    );

    if (!nearDepositSubmitResponse.ok) {
      console.error("Errors submitting deposit");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }

    depositSubmitData = await nearDepositSubmitResponse.json();
    console.log("Near deposit submit response status: ", depositSubmitData?.status);

    if (depositSubmitData?.status === "SUCCESS") {
      break;
    }

    console.log("Trying again, still not successful");
    start = Date.now() - startFetch;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Fetch to double check the success
  await fetch(
    `https://1click.chaindefuser.com/v0/status?depositAddress=${data.quote.depositAddress}`,
  );

  const jupUltraOrder = await getJupUltraOrder(
    new PublicKey(ZEC_MINT),
    new PublicKey(ZENZEC_MINT),
    Number(data.quote.amountOutFormatted) * 10 ** ZCASH_DECIMALS,
    user.publicKey,
    300,
  );

  return await executeJupUltraOrder(jupUltraOrder.transaction, jupUltraOrder.requestId, user);
}

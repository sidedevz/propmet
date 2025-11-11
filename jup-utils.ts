import { VersionedTransaction, type Keypair, type PublicKey } from "@solana/web3.js";
import { retry } from "./retry";

export async function getJupUltraOrder(
  inputMint: PublicKey,
  outPutMint: PublicKey,
  inputAmount: number,
  taker: PublicKey,
  maxSlippage: number,
) {
  const orderResponse = await fetch(
    `https://lite-api.jup.ag/ultra/v1/order?inputMint=${inputMint.toString()}&outputMint=${outPutMint.toString()}&amount=${Math.floor(inputAmount)}&taker=${taker.toString()}`,
  );

  if (!orderResponse.ok) {
    throw new Error(`Error getting ultra order for of ${inputMint} of ${inputAmount} tokens`);
  }
  const response = (await orderResponse.json()) as {
    transaction: string;
    requestId: string;
    slippageBps: number;
    errorMessage?: string;
    outAmount: string;
  };

  if (response.errorMessage != null) {
    throw new Error(
      `Error getting ultra order for ${inputMint} of ${inputAmount} tokens. Error ${response.errorMessage}`,
    );
  }

  if (response.slippageBps > maxSlippage) {
    throw new Error(`Slippage ${response.slippageBps} is greater than max slippage ${maxSlippage}`);
  }

  return response;
}

export async function executeJupUltraOrder(
  transactionBase64: string,
  orderRequesId: string,
  payer: Keypair,
) {
  // Deserialize, sign and serialize the transaction
  const transaction = VersionedTransaction.deserialize(Buffer.from(transactionBase64, "base64"));

  transaction.sign([payer]);
  const signedTransaction = Buffer.from(transaction.serialize()).toString("base64");

  const result = await retry(
    async () => {
      const executeResponse = await fetch("https://lite-api.jup.ag/ultra/v1/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          signedTransaction: signedTransaction,
          requestId: orderRequesId,
        }),
      });

      if (!executeResponse.ok) {
        throw new Error(`Error executing order ${orderRequesId}`);
      }
      const executeResult = (await executeResponse.json()) as {
        status: string;
        signature: string;
        slot: string;
      };

      console.log(`Swap ${executeResult.status === "Success" ? "successful" : "failed"}`);
      console.log(`https://solscan.io/tx/${executeResult.signature}`);

      return executeResult;
    },
    {
      initialDelay: 200,
      maxRetries: 3,
      maxDelay: 5000,
    },
  );

  return result;
}

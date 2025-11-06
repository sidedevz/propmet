import { Connection, PublicKey, type Commitment } from "@solana/web3.js";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

export class Solana {
  readonly connection: Connection;
  constructor(
    private readonly urls: {
      read: string;
      write: string;
      ws: string;
    },
    readonly commitment: Commitment = "confirmed",
  ) {
    this.connection = new Connection(this.urls.read, {
      wsEndpoint: this.urls.ws,
      commitment,
    });
  }

  async sendTransaction(transaction: string, commitment?: Commitment): Promise<string> {
    const response = await fetch(this.urls.write, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [
          transaction,
          {
            skipPreflight: false,
            commitment: commitment ?? this.commitment,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(`Failed to send transaction: ${response.statusText}`);
      throw new Error(`Failed to send transaction: ${response.statusText}`);
    }

    const data: any = await response.json();
    if (data.result == null) {
      console.error(`Error sending transaction: ${data}`);
      throw new Error(`Error sending transaction: ${data}`);
    }

    return data.result;
  }

  // Either confirm or throw exception on confirmation
  async confirmTransactions(signatures: string[]): Promise<
    {
      slot: number;
    }[]
  > {
    // Confirm transactions using websocket subscription to onSignature
    try {
      const slotResults = await Promise.all(
        signatures.map((signature) => this.waitForConfirmation(signature, "confirmed")),
      );
      return slotResults;
    } catch (error) {
      throw new Error(`Error confirming transaction: ${error}`);
      // Type should be void, not return a value
    }
  }

  private async waitForConfirmation(
    signature: string,
    commitment: Commitment = "confirmed",
  ): Promise<{ slot: number }> {
    let subId: number | undefined;

    const signaturePromise = new Promise<{ slot: number }>((resolve, reject) => {
      subId = this.connection.onSignature(
        signature,
        (result: any, slot: any) => {
          if (result.error != null) {
            reject(new Error(`Error checking signature ${signature} - ${result.error}`));
          } else {
            resolve({ slot });
          }
        },
        commitment,
      );
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timeout waiting for confirmation for signature: ${signature}`));
      }, 60_000); // 1 min timeout per tx. More or less 150 blocks (validity of blockhash)
    });

    try {
      const result = await Promise.race([signaturePromise, timeoutPromise]);
      return result;
    } finally {
      // Always cleanup the listener, whether we succeeded, timed out, or errored
      if (subId !== undefined) {
        await this.connection.removeSignatureListener(subId);
      }
    }
  }
}

export async function getTokenBalance(
  user: PublicKey,
  mint: PublicKey,
  connection: Connection,
  minContextSlot?: number,
): Promise<number> {
  const response = await fetch(connection.rpcEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [
        user.toString(),
        { mint: mint.toString() },
        {
          commitment: "confirmed",
          encoding: "jsonParsed",
          minContextSlot: minContextSlot,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get token balance: ${response.statusText}`);
  }

  const data: any = await response.json();
  if (data.result == null) {
    throw new Error(
      `Failed to get token balance for ${mint.toBase58()}: ${data.error?.message ?? "Unknown error"}`,
    );
  }

  const tokenAccountBalance =
    data.result.value.length > 0
      ? Number(data.result.value[0].account.data.parsed.info.tokenAmount.amount)
      : 0;

  if (mint.equals(WSOL_MINT)) {
    const response = await fetch(connection.rpcEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [user.toString(), { commitment: "confirmed", minContextSlot: minContextSlot }],
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to get sol balance: ${response.statusText}`);
    }

    const data: any = await response.json();

    if (data.result == null) {
      throw new Error(`Failed to get sol balance: ${data.error?.message ?? "Unknown error"}`);
    }

    // Always leave 0.05 SOL in the wallet
    const solBalance = Math.max(0, Number(data.result.value) - 50_000_000);

    return solBalance + tokenAccountBalance;
  }

  return tokenAccountBalance;
}

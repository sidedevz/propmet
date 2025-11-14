import { gzipSync } from "node:zlib";
import { JSONStringifyWithBigInt } from "./utils";

export type PositionEvent = {
  timestamp: number;
  pair: string;
  positionAddress: string;
  upperBinId: number;
  lowerBinId: number;
  quoteRawAmount: bigint;
  baseRawAmount: bigint;
  transactionId: string;
  oraclePrice: number;
};

export type WithdrawEvent = {
  timestamp: number;
  pair: string;
  positionAddress: string;
  feesClaimed: bigint;
  quoteRawAmount: bigint;
  baseRawAmount: bigint;
  transactionIds: string[];
};

export type SwapEvent = {
  timestamp: number;
  pair: string;
  initialQuoteRawAmount: bigint;
  initialBaseRawAmount: bigint;
  finalQuoteRawAmount: bigint;
  finalBaseRawAmount: bigint;
  transactionId: string;
};

export type Event =
  | {
      type: "positions";
      event: PositionEvent;
    }
  | {
      type: "withdrawals";
      event: WithdrawEvent;
    }
  | {
      type: "swaps";
      event: SwapEvent;
    };

export class Tinybird {
  private readonly url: string = "http://localhost:7181";
  private readonly token: string;

  constructor(args: {
    url?: string;
    token: string;
  }) {
    this.url = args.url ?? this.url;
    this.token = args.token;
  }

  async logEvent({ event, type }: Event) {
    const jsonPayload = JSONStringifyWithBigInt(event);
    const compressedPayload = gzipSync(jsonPayload);

    const response = await fetch(`${this.url}/v0/events?name=${type}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: compressedPayload,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to log position: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    return response;
  }
}

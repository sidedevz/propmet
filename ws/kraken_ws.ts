import WebSocket from "ws";

import type { WebSocket as WebSocketInterface } from "./interface";
import type { Strategy } from "../strategy";
import type { Logger } from "../logger";

type KrakenTickerData = {
  symbol: string;
  bid: number;
  bid_qty: number;
  ask: number;
  ask_qty: number;
  last: number;
  volume: number;
  vwap: number;
  low: number;
  high: number;
  change: number;
  change_pct: number;
};

export class KrakenWebSocket implements WebSocketInterface {
  private client: WebSocket | null = null;

  constructor(
    private readonly url: string,
    private readonly strategies: { strategy: Strategy; symbolFeeds: string[] }[],
    private readonly logger: Logger,
  ) {}

  async connect() {
    if (this.client != null) {
      console.log("Client already initialized");
      return;
    }
    const newClient = new WebSocket(this.url);
    // Subscribe to the Kraken websocket API for ticker updates for all required symbols
    // Documentation: https://docs.kraken.com/websockets/v2#operation/subscribe

    // Collect all unique symbols needed for all strategies
    const symbols = [...new Set(this.strategies.flatMap((s) => s.symbolFeeds))];

    if (symbols.length === 0) {
      this.logger.error(
        "No symbols provided for base websocket subscription.",
        new Error("No symbols"),
      );
      return;
    }

    // Build the subscribe request according to Kraken v2 WebSocket API
    const subscribePayload = {
      method: "subscribe",
      params: {
        channel: "ticker",
        symbol: symbols,
        event_trigger: "trades", // "bbo" for best-bid-offer updates.
      },
      req_id: Math.floor(Date.now() / 1000),
    };

    newClient.addEventListener("open", () => {
      newClient.send(JSON.stringify(subscribePayload));
      this.logger.info(`Subscribed to ticker updates for symbols: ${symbols.join(", ")}`, {
        symbols,
        channel: "ticker",
        event_trigger: "bbo",
      });
    });

    newClient.addEventListener("message", async (event) => {
      try {
        const parsedEvent = JSON.parse(event.data);

        if (parsedEvent.channel !== "ticker") {
          return;
        }

        const eventData: KrakenTickerData[] = parsedEvent.data;

        const marketStrategyPair: Array<{ marketPrice: number; strategy: Strategy } | null> =
          this.strategies.map((strategy) => {
            let marketPrice: number | null = null;

            if (strategy.symbolFeeds.length === 1) {
              const priceEvent = eventData.find(
                (priceEvent) => priceEvent.symbol === strategy.symbolFeeds[0],
              );

              if (priceEvent == null) {
                this.logger.error(
                  `Price event not found for strategy: ${strategy.strategy.baseToken.mint.toString()}`,
                  new Error(strategy.strategy.baseToken.mint.toString()),
                );

                return null;
              }

              // No need to format as feeds come based on USD, EUR, etc for kraken
              marketPrice = priceEvent.last;
            }

            if (marketPrice != null) {
              return {
                marketPrice,
                strategy: strategy.strategy,
              };
            }

            return null;
          });

        const validMarketStrategyPairs = marketStrategyPair.filter((pair) => pair != null);

        await Promise.all(
          validMarketStrategyPairs.map((pair) => pair.strategy.run(pair.marketPrice)),
        );
      } catch (error: any) {
        this.logger.error("Error parsing event data:", error);
      }
    });

    newClient.addEventListener("error", async (error) => {
      this.onError(error).catch((err) => {
        this.logger.error("Unhandled error in onError:", err);
      });
    });
  }

  async onError(error: any) {
    this.logger.error("Error receiving updates:", {
      ...error,
      message: error?.message ?? "Unknown error",
    });

    if (this.client != null) {
      this.client.removeAllListeners();
      this.client.close();
      this.client = null;
    }

    const reconnectDelay = 1000; // ms
    const maxRetries = 5;
    let retries = 0;

    while (this.client == null && retries < maxRetries) {
      await this.connect();
      await new Promise((resolve) => setTimeout(resolve, reconnectDelay));
      retries++;
    }
  }
}

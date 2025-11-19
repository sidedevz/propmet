import { HermesClient } from "@pythnetwork/hermes-client";
import type { Strategy } from "../strategy";
import type { EventSource, ErrorEvent } from "eventsource";
import type { Logger } from "../logger";
import type { WebSocket } from "./interface";

export class HermesWS implements WebSocket {
  private client: HermesClient;
  private eventSource: EventSource | null = null;

  constructor(
    private readonly url: string,
    private readonly strategies: { strategy: Strategy; priceFeeds: string[] }[],
    private readonly logger: Logger,
  ) {
    this.client = new HermesClient(this.url, {});
  }

  async connect() {
    if (this.eventSource != null || this.strategies.length === 0) {
      return;
    }

    const newEventSource = await this.client.getPriceUpdatesStream(
      this.strategies.flatMap((strategy) => strategy.priceFeeds),
      {
        parsed: true,
      },
    );

    newEventSource.onopen = () => {
      console.log("🟢 Connected to price streams");
      this.eventSource = newEventSource;
    };

    newEventSource.onmessage = async (event) => {
      try {
        const eventData = JSON.parse(event.data).parsed;

        const marketStrategyPair: Array<{ marketPrice: number; strategy: Strategy } | null> =
          this.strategies.map((strategy) => {
            let marketPrice: number;

            if (strategy.priceFeeds.length === 1) {
              const priceFeed = strategy.priceFeeds[0];
              const priceEvent = eventData.find(
                (priceEvent: any) => priceEvent.id === priceFeed?.slice(2),
              );

              if (priceEvent == null) {
                this.logger.error(
                  `Price event not found for strategy: ${strategy.strategy.baseToken.mint.toString()}`,
                  new Error(strategy.strategy.baseToken.mint.toString()),
                );

                return null;
              }

              marketPrice = priceEvent.price.price / 10 ** (-1 * priceEvent.price.expo);
            } else {
              const basePriceFeed = strategy.priceFeeds[0];
              const quotePriceFeed = strategy.priceFeeds[1];

              const basePriceEvent = eventData.find(
                (priceEvent: any) => priceEvent.id === basePriceFeed?.slice(2),
              );
              const quotePriceEvent = eventData.find(
                (priceEvent: any) => priceEvent.id === quotePriceFeed?.slice(2),
              );

              if (basePriceEvent == null || quotePriceEvent == null) {
                const errorMint =
                  basePriceEvent == null
                    ? strategy.strategy.baseToken.mint.toString()
                    : strategy.strategy.quoteToken.mint.toString();
                this.logger.error(
                  `Price event not found for mint ${errorMint}`,
                  new Error(errorMint),
                );

                return null;
              }

              const basePrice = basePriceEvent.price.price / 10 ** (-1 * basePriceEvent.price.expo);
              const quotePrice =
                quotePriceEvent.price.price / 10 ** (-1 * quotePriceEvent.price.expo);

              marketPrice = basePrice / quotePrice;
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
    };

    newEventSource.onerror = async (error) => {
      this.onError(error).catch((err) => {
        this.logger.error("Unhandled error in onError:", err);
      });
    };
  }

  async onError(error: ErrorEvent) {
    this.logger.error("Error receiving updates from Hermes:", {
      message: error.message ?? "Unknown error",
      ...error,
    });

    if (this.eventSource != null) {
      this.eventSource.onmessage = null;
      this.eventSource.onerror = null;
      this.eventSource.close();
      this.eventSource = null;
    }

    const reconnectDelay = 1000; // ms
    const maxRetries = 5;
    let retries = 0;

    while (this.eventSource == null && retries < maxRetries) {
      await this.connect();
      await new Promise((resolve) => setTimeout(resolve, reconnectDelay));
      retries++;
    }
  }
}

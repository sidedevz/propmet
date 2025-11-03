import { HermesClient } from "@pythnetwork/hermes-client";
import type { Strategy } from "./strategy";
import type { EventSource, ErrorEvent } from "eventsource";

export class HermesWS {
  private client: HermesClient;
  private eventSource: EventSource | null = null;

  constructor(
    url: string,
    private readonly strategies: { strategy: Strategy; priceFeeds: string[] }[],
  ) {
    this.client = new HermesClient(url, {});
  }

  async connect() {
    if (this.eventSource != null) {
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

        for (const strategy of this.strategies) {
          let marketPrice: number;

          if (strategy.priceFeeds.length === 1) {
            const priceFeed = strategy.priceFeeds[0];
            const priceEvent = eventData.find(
              (priceEvent: any) => priceEvent.id === priceFeed?.slice(2),
            );

            if (priceEvent == null) {
              console.error(
                "Price event not found for strategy:",
                strategy.strategy.baseToken.mint.toString(),
              );
              continue;
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
              console.error(
                "Price event not found for strategy:",
                strategy.strategy.baseToken.mint.toString(),
              );
              continue;
            }

            const basePrice = basePriceEvent.price.price / 10 ** (-1 * basePriceEvent.price.expo);
            const quotePrice =
              quotePriceEvent.price.price / 10 ** (-1 * quotePriceEvent.price.expo);

            marketPrice = basePrice / quotePrice;
          }

          if (marketPrice != null) {
            await strategy.strategy.run(marketPrice);
          }
        }
      } catch (error) {
        console.error("Error parsing event data:", error);
      }
    };

    newEventSource.onerror = async (error) => {
      this.onError(error).catch((err) => {
        console.error("Unhandled error in onError:", err);
      });
    };
  }

  private async onError(error: ErrorEvent) {
    console.error("Error receiving updates:", error);

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

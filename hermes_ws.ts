import { HermesClient } from "@pythnetwork/hermes-client";
import type { Strategy } from "./strategy";
import type { EventSource, ErrorEvent } from "eventsource";

export class HermesWS {
  private client: HermesClient;
  private eventSource: EventSource | null = null;
  private strategy: Strategy;
  constructor(
    url: string,
    strategy: Strategy,
    readonly priceFeeds: string[],
  ) {
    this.client = new HermesClient(url, {});
    this.strategy = strategy;
  }

  async connect() {
    if (this.eventSource != null) {
      return;
    }

    const newEventSource = await this.client.getPriceUpdatesStream(this.priceFeeds, {
      parsed: true,
    });

    newEventSource.onopen = () => {
      console.log("🟢 Connected to price streams");
      this.eventSource = newEventSource;
    };

    newEventSource.onmessage = async (event) => {
      this.onMessage(event, this.strategy).catch((err) => {
        console.error("Unhandled error in onMessage:", err);
      });
    };

    newEventSource.onerror = async (error) => {
      this.onError(error).catch((err) => {
        console.error("Unhandled error in onError:", err);
      });
    };
  }

  private async onMessage(event: MessageEvent<any>, strategy: Strategy) {
    try {
      const eventData = JSON.parse(event.data).parsed;

      // NOTE: We have to make sure the `[0]` is the base token and `[1]` is the quote token
      const marketPrice =
        eventData.length > 1
          ? eventData[0].price.price / eventData[1].price.price
          : eventData[0].price.price / 10 ** (-1 * eventData[0].price.expo);

      await strategy.run(marketPrice);
    } catch (error) {
      console.error("Error parsing event data:", error);
    }
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

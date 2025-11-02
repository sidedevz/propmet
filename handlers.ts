import { HermesClient } from "@pythnetwork/hermes-client";
import type { Strategy } from "./strategy";
import { EventSource, type ErrorEvent } from "eventsource";
import { retry } from "./retry";

export class HermesWS {
  private client: HermesClient;
  private eventSource: EventSource | undefined;
  private strategy: Strategy;
  private isReconnecting = false;

  constructor(
    url: string,
    strategy: Strategy,
    readonly priceFeeds: string[],
  ) {
    this.client = new HermesClient(url, {});
    this.strategy = strategy;
  }

  async connect() {
    this.eventSource = await this.client.getPriceUpdatesStream(this.priceFeeds, {
      parsed: true,
    });

    this.eventSource.onopen = () => {
      console.log("🟢 Connected to price streams");
    };

    this.eventSource.onmessage = async (event) => {
      this.onMessage(event, this.strategy).catch((err) => {
        console.error("Unhandled error in onMessage:", err);
      });
    };

    this.eventSource.onerror = async (error) => {
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

    // Control to avoid race conditions
    if (this.isReconnecting || this.eventSource?.readyState === EventSource.OPEN) {
      return;
    }

    const reconnectDelay = 1000; // ms

    this.isReconnecting = true;

    try {
      // Attempt to reconnect after a short delay
      await retry(
        async () => {
          console.log(`Attempting to reconnect in ${reconnectDelay / 1000} seconds...`);

          const currentEventSource = this.eventSource;
          if (currentEventSource != null) {
            currentEventSource.onmessage = null;
            currentEventSource.onerror = null;
            currentEventSource.close();
          }

          await this.connect(); // Always try to reconnect, even if eventSource was null
        },
        {
          initialDelay: reconnectDelay,
          maxRetries: 3,
          maxDelay: 12000,
        },
      );

      const connected = await this.checkConnection();

      if (!connected) {
        console.error("💥 Error reconnecting - could not connect to event source");
        throw new Error("Error reconnecting");
      }
    } finally {
      this.isReconnecting = false; // Always reset flag, even on error
    }
  }

  // Loop for 3 seconds max so see if WS is connected
  async checkConnection() {
    const timeout = 3000;
    let progressTime = 0;

    if (this.eventSource == null) {
      return false;
    }

    while (progressTime < timeout) {
      if (this.eventSource.readyState === EventSource.OPEN) {
        return true;
      }

      console.log("Waiting for endpoint to connect");
      progressTime += 100;

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
  }
}

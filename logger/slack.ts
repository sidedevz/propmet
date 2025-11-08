import type { Logger, LoggerOptions } from "./interface.js";
import type { Fields } from "./types.js";
import { WebClient } from "@slack/web-api";

export class SlackLogger implements Logger {
  private readonly defaultFields?: Fields;
  private readonly client: WebClient;

  constructor(
    readonly slackToken: string,
    readonly alertChatId: string,
    opts?: LoggerOptions,
  ) {
    this.defaultFields = opts?.defaultFields;
    this.client = new WebClient(slackToken);
  }

  public debug(message: string, fields?: Fields): void {
    console.debug(message, { ...fields, ...this.defaultFields, level: "debug" });
  }

  public info(message: string, fields?: Fields): void {
    console.info(message, { ...fields, ...this.defaultFields, level: "info" });
  }

  public warn(message: string, fields?: Fields): void {
    console.warn(message, { ...fields, ...this.defaultFields, level: "warn" });
  }

  public async error<T extends { message: string; stack?: string }>(
    message: string,
    error: T | null,
    fields?: Fields,
  ): Promise<void> {
    console.error(message, { ...fields, ...this.defaultFields, err: error, level: "error" });

    await this.client.chat.postMessage({
      token: this.slackToken,
      channel: this.alertChatId,
      text: message,
      attachments: [
        {
          color: "#F00",
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: "Error",
                emoji: true,
              },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: message,
              },
            },
            {
              type: "divider",
            },
            ...(fields
              ? Object.entries(fields).map(([key, value]) => ({
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `*${key}:*\n${typeof value === "object" ? `\`\`\`${JSON.stringify(value, null, 2)}\`\`\`` : String(value)}`,
                  },
                }))
              : []),
            ...(error
              ? [
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `*Error Message:*\n${error.message}${error.stack ? `\n*Stack:*\n\`\`\`${error.stack}\`\`\`` : ""}`,
                    },
                  },
                ]
              : []),
          ],
        },
      ],
    });
  }
}

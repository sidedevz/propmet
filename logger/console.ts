import type { Logger, LoggerOptions } from "./interface.js";
import type { Fields } from "./types.js";

export class ConsoleLogger implements Logger {
  private readonly defaultFields?: Fields;

  constructor(opts?: LoggerOptions) {
    this.defaultFields = opts?.defaultFields;
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

  public error<T extends { message: string; stack?: string }>(
    message: string,
    error: T | null,
    fields?: Fields,
  ): void {
    console.error(message, { ...fields, ...this.defaultFields, err: error, level: "error" });
  }
}

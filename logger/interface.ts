import type { Fields } from "./types.js";

export type LoggerOptions = {
  defaultFields?: Fields;
};

export interface Logger {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error<T extends { message: string; stack?: string }>(
    message: string,
    error: T | null,
    fields?: Fields,
  ): void;
}

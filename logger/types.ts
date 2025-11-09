export type Fields = {
  [field: string]: unknown;
};

export const DEBUG_LOG_LEVEL = "debug";
export const INFO_LOG_LEVEL = "info";
export const WARN_LOG_LEVEL = "warn";
export const ERROR_LOG_LEVEL = "error";

export const LogLevels = [
  DEBUG_LOG_LEVEL,
  INFO_LOG_LEVEL,
  WARN_LOG_LEVEL,
  ERROR_LOG_LEVEL,
] as const;

export type LogLevel = (typeof LogLevels)[number];

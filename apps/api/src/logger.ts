import pino from "pino";
import { config } from "./config";

const isDev = config.nodeEnv === "development";

export const logger = pino({
  level: config.logLevel ?? (isDev ? "debug" : "info"),
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname"
        }
      }
    : undefined,
  base: {
    env: config.nodeEnv
  },
  formatters: {
    level: (label) => ({ level: label })
  }
});

// Child loggers for specific modules
export const schedulerLogger = logger.child({ module: "scheduler" });
export const raceLogger = logger.child({ module: "race" });
export const raceDayLogger = logger.child({ module: "raceday" });
export const subscriberLogger = logger.child({ module: "subscriber" });
export const httpLogger = logger.child({ module: "http" });

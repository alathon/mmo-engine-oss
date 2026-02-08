import pino from "pino";

// If not production, pretty print
const isProduction = process.env.NODE_ENV === "production";
const transport = isProduction
  ? undefined
  : {
      target: "pino-pretty",
      options: {
        colorize: true,
        ignore: "pid,hostname",
        translateTime: "SYS:standard",
      },
    };

/**
 * Application logger.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport,
});

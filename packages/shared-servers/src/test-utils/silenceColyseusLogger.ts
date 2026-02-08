import { setLogger } from "@colyseus/core/Logger";

const silentLogger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export const silenceColyseusLogger = (): void => {
  setLogger(silentLogger);
};

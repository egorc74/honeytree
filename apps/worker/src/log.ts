export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

const write = (level: string, msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra }));

/** One JSON object per line, ready for `docker logs` and log shippers. */
export const logger: Logger = {
  info: (msg, extra) => write('info', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  error: (msg, extra) => write('error', msg, extra),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

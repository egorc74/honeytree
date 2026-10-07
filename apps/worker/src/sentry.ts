import * as Sentry from '@sentry/node';

let enabled = false;

/** Turns on error tracking when SENTRY_DSN is set; otherwise everything here is a no-op. */
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.TAG,
    serverName: 'worker',
  });
  enabled = true;
}

export function captureError(err: unknown, context?: Record<string, unknown>) {
  if (enabled) Sentry.captureException(err, { extra: context });
}

/** Sends pending events before the process exits. */
export async function flushSentry() {
  if (enabled) await Sentry.flush(2000);
}

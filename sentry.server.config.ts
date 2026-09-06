// Sentry on the server. Disabled unless SENTRY_DSN is set, so the app never
// ships error data to an account its owner does not control.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    enableLogs: true,
    debug: false,
  });
}

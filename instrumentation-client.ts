// Sentry in the browser. Disabled unless NEXT_PUBLIC_SENTRY_DSN is set.
//
// Session Replay records what users do on the page, so it stays off unless the
// DSN is explicitly configured and replay explicitly enabled.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    integrations:
      process.env.NEXT_PUBLIC_SENTRY_REPLAY === "true"
        ? [Sentry.replayIntegration()]
        : [],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
    debug: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

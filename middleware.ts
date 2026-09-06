// middleware.ts
import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params.
    // The dot MUST be written as \\. - a single \. is not a valid string escape,
    // so it collapses to "any character" and the extension list then matches real
    // routes. That made /companions/[id]/documents look like a ".doc" file and
    // skip Clerk entirely.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
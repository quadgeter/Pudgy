import { Hono } from "hono";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "./router.ts";
import { serve } from "@hono/node-server";

const app = new Hono();

app.use("/trpc/*", cors());
app.use("/trpc/*", trpcServer({ router: appRouter }));

serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});

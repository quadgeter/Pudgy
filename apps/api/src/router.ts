import { router, publicProcedure } from "./trpc.ts";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" as const })),
});

export type AppRouter = typeof appRouter;

import { protectedProcedure, publicProcedure, router } from "../index";
import { datasetsRouter } from "./datasets";
import { filesRouter } from "./files";

export const appRouter = router({
  datasets: datasetsRouter,
  files: filesRouter,
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
});
export type AppRouter = typeof appRouter;

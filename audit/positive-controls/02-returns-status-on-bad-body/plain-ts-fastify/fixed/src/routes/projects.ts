// Fix: plain-TS body validation. Empty/missing name → 400.
// This is the Quantasyte shape that motivated hasPlainTsBodyValidation.
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export default async function projectsRoutes(app: FastifyInstance) {
  app.post("/api/projects", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { name?: string };
    const name = body?.name;
    if (typeof name !== "string" || !name.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    return reply.send({ id: 1, name });
  });
}

// Buggy state: handler trusts req.body shape. No validation.
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export default async function projectsRoutes(app: FastifyInstance) {
  app.post("/api/projects", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { name?: string };
    return reply.send({ id: 1, name: body.name });
  });
}

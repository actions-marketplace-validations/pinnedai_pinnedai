import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { exportAllUsers } from "../controllers/adminExport.js";

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      reply.code(401).send({ error: "auth_required" });
    }
  });
  app.post("/api/admin/export", exportAllUsers);
}

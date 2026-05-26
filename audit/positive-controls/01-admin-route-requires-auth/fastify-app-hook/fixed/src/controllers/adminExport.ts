import type { FastifyRequest, FastifyReply } from "fastify";

export async function exportAllUsers(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ users: [{ id: 1, email: "u1@example.com" }] });
}

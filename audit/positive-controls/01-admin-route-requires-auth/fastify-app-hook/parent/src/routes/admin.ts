import type { FastifyInstance } from "fastify";
import { exportAllUsers } from "../controllers/adminExport.js";

export default async function adminRoutes(app: FastifyInstance) {
  app.post("/api/admin/export", exportAllUsers);
}

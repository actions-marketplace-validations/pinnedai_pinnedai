// Buggy state: handler ships full user table with no auth gate
// upstream. Used by /api/admin/export — see src/routes/admin.ts.
import type { Request, Response } from "express";

export async function exportAllUsers(_req: Request, res: Response) {
  // pretend this hits the DB and dumps every user
  res.json({ users: [{ id: 1, email: "u1@example.com" }] });
}

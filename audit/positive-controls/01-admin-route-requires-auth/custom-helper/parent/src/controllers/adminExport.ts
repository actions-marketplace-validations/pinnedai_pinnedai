import type { Request, Response } from "express";

export async function exportAllUsers(_req: Request, res: Response) {
  res.json({ users: [{ id: 1, email: "u1@example.com" }] });
}

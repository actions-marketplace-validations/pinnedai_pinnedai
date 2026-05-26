// requireAuth — Express middleware that 401s on missing/invalid Bearer.
import type { Request, Response, NextFunction } from "express";

export function requireAuth() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      res.status(401).json({ error: "auth_required" });
      return;
    }
    next();
  };
}

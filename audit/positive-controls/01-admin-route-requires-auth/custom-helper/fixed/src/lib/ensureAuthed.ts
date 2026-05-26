import type { Request, Response, NextFunction } from "express";

// Bespoke auth-helper name — exactly the shape that breaks
// canonical-name regex detection (per Quantasyte's authHeaders()).
// Must end in one of our recognized suffixes (Required/Check/Guard/...) to fire.
export function ensureAuthed() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      res.status(401).json({ error: "auth_required" });
      return;
    }
    next();
  };
}

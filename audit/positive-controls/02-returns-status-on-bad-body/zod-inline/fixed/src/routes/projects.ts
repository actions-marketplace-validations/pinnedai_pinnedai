// Fix: Zod schema enforced on incoming body. 400 on validation failure.
import express from "express";
import { z } from "zod";

const router = express.Router();

const ProjectBody = z.object({
  name: z.string().min(1).max(120),
});

router.post("/api/projects", (req, res) => {
  const parsed = ProjectBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }
  res.json({ id: 1, name: parsed.data.name });
});

export default router;

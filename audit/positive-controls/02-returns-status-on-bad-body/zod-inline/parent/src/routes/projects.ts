// Buggy state: POST /api/projects accepts any body — no validation.
// Saving garbage rows + crashing on null fields = silent corruption.
import express from "express";

const router = express.Router();

router.post("/api/projects", (req, res) => {
  // No schema enforced; req.body could be {} or anything
  res.json({ id: 1, name: req.body.name });
});

export default router;

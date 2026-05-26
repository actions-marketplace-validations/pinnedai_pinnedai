import express from "express";
const router = express.Router();
router.post("/api/signup", (req, res) => {
  res.json({ id: 1, email: req.body.email });
});
export default router;

import express from "express";
import * as yup from "yup";

const SignupBody = yup.object({
  email: yup.string().email().required(),
  password: yup.string().min(8).required(),
});

const router = express.Router();
router.post("/api/signup", async (req, res) => {
  try {
    const parsed = await SignupBody.validate(req.body, { abortEarly: false });
    res.json({ id: 1, email: parsed.email });
  } catch (e) {
    res.status(400).json({ error: "invalid_body", details: (e as Error).message });
  }
});
export default router;

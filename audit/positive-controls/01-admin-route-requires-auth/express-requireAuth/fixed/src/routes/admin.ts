// Fix: requireAuth() middleware added in front of admin export.
import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { exportAllUsers } from "../controllers/adminExport.js";

const router = express.Router();

router.post("/api/admin/export", requireAuth(), exportAllUsers);

export default router;

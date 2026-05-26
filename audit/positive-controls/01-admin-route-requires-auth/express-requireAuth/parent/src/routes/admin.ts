// Buggy state: admin export route has NO auth check. Anyone can hit it.
import express from "express";
import { exportAllUsers } from "../controllers/adminExport.js";

const router = express.Router();

// MISSING: requireAuth() — anonymous callers reach exportAllUsers.
router.post("/api/admin/export", exportAllUsers);

export default router;

import express from "express";
import { ensureAuthed } from "../lib/ensureAuthed.js";
import { exportAllUsers } from "../controllers/adminExport.js";

const router = express.Router();
router.post("/api/admin/export", ensureAuthed(), exportAllUsers);
export default router;

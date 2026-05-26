import express from "express";
import { exportAllUsers } from "../controllers/adminExport.js";

const router = express.Router();
router.post("/api/admin/export", exportAllUsers);
export default router;

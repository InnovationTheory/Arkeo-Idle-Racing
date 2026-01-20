import { Router } from "express";
import { checkRateLimit } from "./rateLimit";
import { asyncHandler } from "./utils/asyncHandler";

// Route modules
import userRoutes from "./users";
import bankRoutes from "./bank";
import raceRoutes from "./races";
import bettingRoutes from "./betting";
import raceDayRoutes from "./racedays";
import adminRoutes from "./admin";
import subscriberRoutes from "./subscriber";
import docsRoutes from "./docs";
import chatRoutes from "./chat";

const router = Router();
const ipWindowMs = 60_000;
const isDev = process.env.NODE_ENV !== "production";

// Global rate limiting middleware (disabled in development)
router.use((req, res, next) => {
  if (isDev) {
    next();
    return;
  }
  const ipKey = `ip:${req.ip}`;
  const max = req.method === "GET" ? 1000 : 500;
  if (!checkRateLimit(ipKey, max, ipWindowMs)) {
    res.status(429).json({ error: "rate_limited" });
    return;
  }
  next();
});

// Health check
router.get(
  "/health",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  })
);

// Mount route modules
router.use("/", userRoutes);
router.use("/bank", bankRoutes);
router.use("/races", raceRoutes);
router.use("/", bettingRoutes);
router.use("/racedays", raceDayRoutes);
router.use("/admin", adminRoutes);
router.use("/subscriber", subscriberRoutes);
router.use("/docs", docsRoutes);
router.use("/chat", chatRoutes);

export default router;

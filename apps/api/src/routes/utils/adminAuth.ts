import { Request, Response, NextFunction } from "express";
import { config } from "../../config";

export function requireAdminKey(req: Request, res: Response, next: NextFunction) {
  if (!config.adminApiKey) {
    res.status(503).json({ error: "admin_not_configured" });
    return;
  }
  const providedKey = req.get("X-Admin-Key");
  if (!providedKey || providedKey !== config.adminApiKey) {
    res.status(401).json({ error: "invalid_admin_key" });
    return;
  }
  next();
}

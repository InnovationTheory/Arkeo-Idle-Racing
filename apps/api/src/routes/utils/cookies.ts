import { CookieOptions } from "express";
import { config } from "../../config";

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  // sameSite: "none" requires secure: true (HTTPS)
  // For development, omit sameSite to use browser default (helps Safari)
  ...(config.isProduction ? { sameSite: "lax" as const, secure: true } : {}),
  path: "/",
};

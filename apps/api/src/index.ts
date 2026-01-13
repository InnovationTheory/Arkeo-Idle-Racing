import http from "http";
import express, { ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { initWebSocket } from "./ws";
import routes from "./routes";
import { initScheduler, stopScheduler } from "./scheduler";
import { prisma } from "./db";
import { AppError } from "./errors";
import { logger, httpLogger, schedulerLogger } from "./logger";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use("/api", routes);

const staticEnabled = process.env.SERVE_WEB_STATIC === "1";
const staticDir = process.env.WEB_STATIC_DIR;
if (staticEnabled && staticDir && fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  // Handle custom AppError classes
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.code });
    return;
  }

  // Handle Prisma unique constraint violations
  const prismaError = error as { code?: string; meta?: { target?: string[] } };
  if (prismaError?.code === "P2002" && Array.isArray(prismaError?.meta?.target)) {
    if (prismaError.meta.target.includes("paymentTxHash")) {
      res.status(409).json({ error: "payment_tx_used" });
      return;
    }
    if (prismaError.meta.target.includes("nicknameLower")) {
      res.status(409).json({ error: "nickname_taken" });
      return;
    }
  }

  httpLogger.error({ err: error }, "Unhandled request error");
  res.status(500).json({ error: "internal_error" });
};
app.use(errorHandler);

const server = http.createServer(app);
initWebSocket(server);

server.listen(config.httpPort, () => {
  logger.info({ port: config.httpPort }, "API server started");
});

if (config.autoRaceEnabled) {
  initScheduler().catch((error) => {
    schedulerLogger.fatal({ err: error }, "Scheduler initialization failed");
  });
}

process.on("SIGINT", async () => {
  await stopScheduler();
  await prisma.$disconnect();
  process.exit(0);
});

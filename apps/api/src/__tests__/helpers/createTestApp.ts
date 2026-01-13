import express, { ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import routes from "../../routes";
import { AppError } from "../../errors";

export function createTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", routes);

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.code });
      return;
    }

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

    res.status(500).json({ error: "internal_error" });
  };
  app.use(errorHandler);

  return app;
}

import { z } from "zod";
import { Request, Response, NextFunction } from "express";
import { ValidationError } from "../../errors";

type ValidatedRequest<T> = Request & { validated: T };

export function validate<T extends z.ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params
    });

    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue.path.filter((p) => p !== "body" && p !== "query" && p !== "params");
      const code = path.length > 0 ? `invalid_${path.join("_")}` : "invalid_request";
      throw new ValidationError(code, issue.message);
    }

    (req as ValidatedRequest<z.infer<T>>).validated = result.data;
    next();
  };
}

export type Validated<T extends z.ZodSchema> = z.infer<T>;

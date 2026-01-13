import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";
import YAML from "yaml";
import { httpLogger } from "../logger";

const router = Router();

// Load OpenAPI spec
const specPath = path.join(__dirname, "../openapi.yaml");
let spec: object = {};

try {
  const specFile = fs.readFileSync(specPath, "utf8");
  spec = YAML.parse(specFile);
} catch (error) {
  httpLogger.warn({ err: error }, "Failed to load OpenAPI spec");
}

// Serve Swagger UI
router.use("/", swaggerUi.serve);
router.get("/", swaggerUi.setup(spec, {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "Arkeo Racing API Docs"
}));

// Serve raw OpenAPI spec
router.get("/openapi.json", (_req, res) => {
  res.json(spec);
});

router.get("/openapi.yaml", (_req, res) => {
  res.type("text/yaml").send(fs.readFileSync(specPath, "utf8"));
});

export default router;

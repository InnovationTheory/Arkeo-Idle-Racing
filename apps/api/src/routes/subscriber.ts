import { Router } from "express";
import { fetchSubscriberServices } from "../subscriber/discovery";
import { asyncHandler } from "./utils/asyncHandler";

const router = Router();

router.get(
  "/services",
  asyncHandler(async (_req, res) => {
    const services = await fetchSubscriberServices();
    res.json({ services });
  })
);

export default router;

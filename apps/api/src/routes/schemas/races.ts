import { z } from "zod";
import { uuidParam, paginationQuery } from "./common";

// GET /races - List races with pagination
export const listRacesSchema = z.object({
  query: paginationQuery
});

// GET /races/:raceId - Get race details
export const getRaceSchema = z.object({
  params: z.object({
    raceId: uuidParam
  })
});

// GET /races/:raceId/polls - Get race polls
export const getRacePollsSchema = z.object({
  params: z.object({
    raceId: uuidParam
  }),
  query: z.object({
    phase: z.enum(["prep", "warmup", "running", "cooldown"]).optional()
  })
});

// GET /races/:raceId/providers - Get race providers
export const getRaceProvidersSchema = z.object({
  params: z.object({
    raceId: uuidParam
  })
});

// GET /races/:raceId/results - Get race results
export const getRaceResultsSchema = z.object({
  params: z.object({
    raceId: uuidParam
  })
});

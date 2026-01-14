import { z } from "zod";
import { uuidParam } from "./common";

// POST /racedays/create - Create a new race day
export const createRaceDaySchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    startAt: z.string().datetime().optional(),
    tickMs: z.number().int().min(100).max(10000).optional(),
    raceDurationSecs: z.number().int().min(10).max(600).optional(),
    pickWindowSecs: z.number().int().min(5).max(21600).optional(),
    bufferSecs: z.number().int().min(0).max(120).optional(),
    maxParallelHeats: z.number().int().min(1).max(8).optional(),
    poolCredits: z.number().int().min(1).max(10000).optional()
  })
});

// POST /racedays/:id/start - Start a race day
export const startRaceDaySchema = z.object({
  params: z.object({
    id: uuidParam
  })
});

// GET /racedays/:id - Get race day state
export const getRaceDaySchema = z.object({
  params: z.object({
    id: uuidParam
  })
});

// GET /racedays/:id/heats/:heatId - Get specific heat state
export const getRaceDayHeatSchema = z.object({
  params: z.object({
    id: uuidParam,
    heatId: uuidParam
  })
});

// GET /racedays/:id/selection - Get user's selection for a race day
export const getRaceDaySelectionSchema = z.object({
  params: z.object({
    id: uuidParam
  })
});

// POST /racedays/:id/selection - Set user's selection for a race day
export const setRaceDaySelectionSchema = z.object({
  params: z.object({
    id: uuidParam
  }),
  body: z.object({
    raceDayHorseId: uuidParam
  })
});

// DELETE /racedays/:id/selection - Clear user's selection for a race day
export const deleteRaceDaySelectionSchema = z.object({
  params: z.object({
    id: uuidParam
  })
});

// GET /racedays/:id/leaderboard - Get all player selections for a race day
export const getRaceDayLeaderboardSchema = z.object({
  params: z.object({
    id: uuidParam
  })
});

// GET /racedays/:id/payouts - Get persisted payouts for a race day
export const getRaceDayPayoutsSchema = z.object({
  params: z.object({
    id: uuidParam
  })
});

// POST /racedays/:id/process-payouts - Process and send ARKEO payouts
export const processRaceDayPayoutsSchema = z.object({
  params: z.object({
    id: uuidParam
  })
});

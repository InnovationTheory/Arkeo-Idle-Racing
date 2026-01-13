import { z } from "zod";
import { uuidParam, handleSchema, txHashSchema } from "./common";

// POST /races/:raceId/tickets - Create a ticket with payment
export const createTicketSchema = z.object({
  params: z.object({
    raceId: uuidParam
  }),
  body: z.object({
    type: z.enum(["single", "pick3"]).optional(),
    handle: handleSchema.optional(),
    paymentTxHash: txHashSchema
  })
});

// POST /races/:raceId/selection - Set race selection
export const setSelectionSchema = z.object({
  params: z.object({
    raceId: uuidParam
  }),
  body: z.object({
    raceHorseId: uuidParam
  })
});

// POST /races/:raceId/picks - Submit picks for a ticket
export const submitPicksSchema = z.object({
  params: z.object({
    raceId: uuidParam
  }),
  body: z.object({
    ticketId: uuidParam,
    raceHorseIds: z.array(uuidParam).min(1).max(3)
  })
});

// GET /races/:raceId/bets - Get all bets for a race
export const getRaceBetsSchema = z.object({
  params: z.object({
    raceId: uuidParam
  })
});

// GET /races/:raceId/selection - Get user's selection for a race
export const getSelectionSchema = z.object({
  params: z.object({
    raceId: uuidParam
  })
});

// DELETE /races/:raceId/selection - Clear user's selection for a race
export const deleteSelectionSchema = z.object({
  params: z.object({
    raceId: uuidParam
  })
});

// GET /races/:raceId/selections - Get all selections for a race
export const getSelectionsSchema = z.object({
  params: z.object({
    raceId: uuidParam
  })
});

// GET /me/tickets - Get user's tickets (optional raceId filter)
export const getMyTicketsSchema = z.object({
  query: z.object({
    raceId: uuidParam.optional()
  })
});

// GET /me/payouts - Get user's payouts (optional raceId filter)
export const getMyPayoutsSchema = z.object({
  query: z.object({
    raceId: uuidParam.optional()
  })
});

import { Pick, RaceHorse, Ticket, Prisma } from "@prisma/client";

type RaceHorseWithHorse = RaceHorse & {
  horse: { handicapTier: string };
};

type TicketWithPicks = Ticket & { picks: Pick[] };

export type PayoutResult = {
  ticketId: string;
  userId: string;
  amountCredits: number;
  breakdown: Prisma.JsonObject;
};

export function computePayouts(params: {
  tickets: TicketWithPicks[];
  raceHorses: RaceHorseWithHorse[];
  payoutBudget: number;
}): { payouts: PayoutResult[]; totalRaw: number; scale: number } {
  const placementByRaceHorseId = new Map(
    params.raceHorses
      .filter((raceHorse) => raceHorse.placement !== null)
      .map((raceHorse) => [raceHorse.id, raceHorse.placement as number])
  );

  const topThree = new Set(
    params.raceHorses
      .filter((raceHorse) => raceHorse.placement !== null && raceHorse.placement <= 3)
      .map((raceHorse) => raceHorse.id)
  );

  const placementBudget = Math.floor(params.payoutBudget * 0.6);
  const jackpotBudget = params.payoutBudget - placementBudget;
  const placementSplits: Record<number, number> = { 1: 0.5, 2: 0.3, 3: 0.2 };

  const placementWinners = new Map<number, TicketWithPicks[]>();
  const jackpotWinners: TicketWithPicks[] = [];

  for (const ticket of params.tickets) {
    if (ticket.type === "single") {
      const pick = ticket.picks[0];
      const placement = pick ? placementByRaceHorseId.get(pick.raceHorseId) : undefined;
      if (placement && placement <= 3) {
        const list = placementWinners.get(placement) ?? [];
        list.push(ticket);
        placementWinners.set(placement, list);
      }
    }

    if (ticket.type === "pick3") {
      const hits = ticket.picks.filter((pick) => topThree.has(pick.raceHorseId)).length;
      if (hits === 3) {
        jackpotWinners.push(ticket);
      }
    }
  }

  const rawPayouts: Array<{
    ticketId: string;
    userId: string;
    rawReward: number;
    breakdown: Prisma.JsonObject;
  }> = [];

  for (const placement of [1, 2, 3]) {
    const winners = placementWinners.get(placement) ?? [];
    if (winners.length === 0) continue;

    const budget = placementBudget * (placementSplits[placement] ?? 0);
    const share = Math.floor(budget / winners.length);

    for (const ticket of winners) {
      rawPayouts.push({
        ticketId: ticket.id,
        userId: ticket.userId,
        rawReward: share,
        breakdown: {
          ticketType: ticket.type,
          placement,
          placementBudget,
          share
        } as Prisma.JsonObject
      });
    }
  }

  if (jackpotWinners.length > 0) {
    const share = Math.floor(jackpotBudget / jackpotWinners.length);
    for (const ticket of jackpotWinners) {
      rawPayouts.push({
        ticketId: ticket.id,
        userId: ticket.userId,
        rawReward: share,
        breakdown: {
          ticketType: ticket.type,
          jackpotBudget,
          share
        } as Prisma.JsonObject
      });
    }
  }

  const totalRaw = rawPayouts.reduce((sum, payout) => sum + payout.rawReward, 0);
  const scale = totalRaw > params.payoutBudget && params.payoutBudget > 0
    ? params.payoutBudget / totalRaw
    : 1;

  const payouts = rawPayouts
    .map((payout) => {
      const amountCredits = Math.floor(payout.rawReward * scale);
      return {
        ticketId: payout.ticketId,
        userId: payout.userId,
        amountCredits,
        breakdown: {
          ...payout.breakdown,
          scaledBy: scale,
          rawReward: payout.rawReward
        } as Prisma.JsonObject
      };
    })
    .filter((payout) => payout.amountCredits > 0);

  return { payouts, totalRaw, scale };
}

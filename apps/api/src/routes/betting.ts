import { Router } from "express";
import { RaceStatus, TicketType } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { checkRateLimit } from "./rateLimit";
import { asyncHandler } from "./utils/asyncHandler";
import { validate } from "./utils/zodValidate";
import { isValidHandle, isValidTxHash, isValidWalletAddress } from "./utils/validators";
import { normalizeHandle, normalizeTxHash } from "./utils/normalizers";
import { fetchArkeoTx, findBankPaymentMessage } from "./utils/arkeo";
import { getHotWalletAddress } from "../arkeo/send";
import { ArkeoTxResponse } from "../types/arkeo";
import { getOrCreateUser, requireSessionUser, ensureBalance, getSessionToken } from "./utils/session";
import { sessionCookieOptions } from "./utils/cookies";
import { ConflictError } from "../errors";
import {
  getRaceBetsSchema,
  deleteSelectionSchema,
  getSelectionSchema,
  getSelectionsSchema,
  setSelectionSchema,
  submitPicksSchema
} from "./schemas/betting";
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS, MAX_IDEMPOTENCY_KEY_LENGTH } from "./constants";
import { broadcastToChat } from "../ws";

// Selection announcement templates - {player} and {horse} will be replaced
const SELECTION_MESSAGES = [
  "🐴 {player} is backing {horse}!",
  "🏇 {player} puts their faith in {horse}!",
  "⚡ {player} likes the look of {horse}!",
  "🎯 {player} is riding with {horse}!",
  "🔥 {player} believes in {horse}!",
  "💪 {player} is all in on {horse}!",
  "🌟 {player} picks {horse} to win!",
  "🎲 {player} rolls the dice on {horse}!",
  "👀 {player} has their eye on {horse}!",
  "🚀 {player} is launching with {horse}!",
  "💎 {player} found a gem in {horse}!",
  "🏆 {player} thinks {horse} has what it takes!",
  "⭐ {player} is starstruck by {horse}!",
  "🎪 {player} joins team {horse}!",
  "🤝 {player} teams up with {horse}!",
  "📣 {player} cheers for {horse}!",
  "🎬 {player} casts {horse} as the winner!",
  "🧲 {player} is drawn to {horse}!",
  "🔮 {player} foresees victory for {horse}!",
  "💫 {player} sees a star in {horse}!",
  "🎰 {player} bets on {horse}!",
  "🏅 {player} awards their vote to {horse}!",
  "📍 {player} pins their hopes on {horse}!",
  "🎯 {player} sets sights on {horse}!",
  "⚔️ {player} champions {horse}!",
  "🛡️ {player} defends {horse}'s honor!",
  "🌈 {player} chases gold with {horse}!",
  "🦄 {player} spots magic in {horse}!",
  "🔑 {player} sees potential in {horse}!",
  "💰 {player} invests in {horse}!",
  "🎁 {player} picks {horse} as their gift!",
  "🧭 {player} charts a course with {horse}!",
  "⛵ {player} sails with {horse}!",
  "🚂 {player} boards the {horse} train!",
  "✈️ {player} flies with {horse}!",
  "🏄 {player} rides the {horse} wave!",
  "🎸 {player} rocks with {horse}!",
  "🥊 {player} goes to battle with {horse}!",
  "🏹 {player} takes aim with {horse}!",
  "🎳 {player} strikes with {horse}!",
  "⚾ {player} swings for the fences with {horse}!",
  "🏀 {player} takes the shot with {horse}!",
  "⚽ {player} scores with {horse}!",
  "🎾 {player} aces it with {horse}!",
  "🏈 {player} huddles with {horse}!",
  "🥅 {player} goes for the goal with {horse}!",
  "🏒 {player} hits the ice with {horse}!",
  "🎿 {player} hits the slopes with {horse}!",
  "🏋️ {player} lifts up {horse}!",
  "🤞 {player} crosses fingers for {horse}!",
];

function getRandomSelectionMessage(player: string, horse: string): string {
  const template = SELECTION_MESSAGES[Math.floor(Math.random() * SELECTION_MESSAGES.length)];
  return template.replace("{player}", player).replace("{horse}", horse);
}

const router = Router();
const sessionWindowMs = RATE_LIMIT_WINDOW_MS;

router.get(
  "/me/tickets",
  asyncHandler(async (req, res) => {
    const user = await requireSessionUser(req, res);
    if (!user) return;
    const raceId = req.query.raceId as string | undefined;
    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, ...(raceId ? { raceId } : {}) },
      include: {
        picks: { include: { raceHorse: { include: { horse: true, serviceType: true } } } },
        race: true
      },
      orderBy: { createdAt: "desc" }
    });
    res.json({
      tickets: tickets.map((ticket) => ({
        ticketId: ticket.id,
        raceId: ticket.raceId,
        type: ticket.type,
        costCredits: ticket.costCredits,
        createdAt: ticket.createdAt,
        picks: ticket.picks.map((pick) => ({
          raceHorseId: pick.raceHorseId,
          horseName: pick.raceHorse.horse.displayName,
          serviceType: pick.raceHorse.serviceType.displayName
        }))
      }))
    });
  })
);

router.get(
  "/me/payouts",
  asyncHandler(async (req, res) => {
    const user = await requireSessionUser(req, res);
    if (!user) return;
    const raceId = req.query.raceId as string | undefined;
    const payouts = await prisma.payout.findMany({
      where: { userId: user.id, ...(raceId ? { raceId } : {}) },
      orderBy: { createdAt: "desc" }
    });
    res.json({ payouts });
  })
);

router.get(
  "/races/:raceId/bets",
  validate(getRaceBetsSchema),
  asyncHandler(async (req, res) => {
    const race = await prisma.race.findUnique({
      where: { id: req.params.raceId },
      select: { id: true }
    });
    if (!race) {
      res.status(404).json({ error: "race_not_found" });
      return;
    }

    const tickets = await prisma.ticket.findMany({
      where: { raceId: race.id },
      include: {
        user: true,
        picks: {
          include: {
            raceHorse: {
              include: { horse: true }
            }
          }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    res.json({
      raceId: race.id,
      bets: tickets.map((ticket) => ({
        ticketId: ticket.id,
        createdAt: ticket.createdAt,
        type: ticket.type,
        amount: ticket.costCredits,
        bettor: {
          nickname: ticket.user.nickname,
          walletAddress: ticket.user.walletAddress,
          handle: ticket.user.handle
        },
        picks: ticket.picks.map((pick) => ({
          raceHorseId: pick.raceHorseId,
          horseName: pick.raceHorse.horse.displayName
        }))
      }))
    });
  })
);

router.post(
  "/races/:raceId/tickets",
  asyncHandler(async (req, res) => {
    const { type, handle, paymentTxHash } = req.body as {
      type?: TicketType;
      handle?: string;
      paymentTxHash?: string;
    };
    const normalizedHandle = normalizeHandle(handle);
    if (normalizedHandle && !isValidHandle(normalizedHandle)) {
      res.status(400).json({ error: "invalid_handle" });
      return;
    }

    const normalizedTxHash = normalizeTxHash(paymentTxHash);
    if (!normalizedTxHash || !isValidTxHash(normalizedTxHash)) {
      res.status(400).json({ error: "invalid_payment_tx" });
      return;
    }

    const idempotencyKey = req.get("Idempotency-Key")?.trim();
    if (idempotencyKey && idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      res.status(400).json({ error: "idempotency_key_too_long" });
      return;
    }

    const race = await prisma.race.findUnique({ where: { id: req.params.raceId } });
    if (!race) {
      res.status(404).json({ error: "race_not_found" });
      return;
    }

    if (
      race.status === RaceStatus.running ||
      race.status === RaceStatus.finished ||
      race.status === RaceStatus.voided
    ) {
      res.status(400).json({ error: "picks_closed" });
      return;
    }

    if (type === "pick3") {
      res.status(400).json({ error: "single_only" });
      return;
    }

    const ticketType = TicketType.single;
    const costCredits = Number(config.entryFeeUarkeo);

    const sessionToken = getSessionToken(req);
    const sessionKey = sessionToken ? `session:${sessionToken}` : `session:${normalizedHandle ?? req.ip}`;
    if (!checkRateLimit(sessionKey, RATE_LIMIT_MAX_REQUESTS, sessionWindowMs)) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    let user = sessionToken
      ? await prisma.user.findUnique({ where: { sessionToken } })
      : null;

    if (!user && normalizedHandle) {
      const existing = await prisma.user.findUnique({ where: { handle: normalizedHandle } });
      if (existing) {
        if (idempotencyKey) {
          const previous = await prisma.ticketIdempotency.findUnique({
            where: {
              raceId_userId_key: { raceId: race.id, userId: existing.id, key: idempotencyKey }
            }
          });
          if (previous) {
            res.json(previous.responseJson);
            return;
          }
        }
        res.status(409).json({ error: "handle_taken" });
        return;
      }
    }

    if (!user) {
      user = await getOrCreateUser({ sessionToken, handle: normalizedHandle });
    }

    if (!user.walletAddress) {
      res.status(400).json({ error: "wallet_not_linked" });
      return;
    }

    if (idempotencyKey) {
      const previous = await prisma.ticketIdempotency.findUnique({
        where: {
          raceId_userId_key: { raceId: race.id, userId: user.id, key: idempotencyKey }
        }
      });
      if (previous) {
        res.json(previous.responseJson);
        return;
      }
    }

    const existingTicket = await prisma.ticket.findFirst({
      where: { raceId: race.id, userId: user.id }
    });
    if (existingTicket) {
      res.status(409).json({ error: "bet_already_placed" });
      return;
    }

    const bankAddress = await getHotWalletAddress();
    if (!bankAddress || !isValidWalletAddress(bankAddress)) {
      res.status(503).json({ error: "bank_unavailable" });
      return;
    }

    const existingPayment = await prisma.ticket.findUnique({
      where: { paymentTxHash: normalizedTxHash }
    });
    if (existingPayment) {
      res.status(409).json({ error: "payment_tx_used" });
      return;
    }

    let txPayload: ArkeoTxResponse;
    try {
      txPayload = await fetchArkeoTx(normalizedTxHash);
    } catch {
      res.status(400).json({ error: "payment_tx_not_found" });
      return;
    }

    const txResponse = txPayload?.tx_response ?? txPayload?.txResponse;
    if (!txResponse || typeof txResponse.code !== "number" || txResponse.code !== 0) {
      res.status(400).json({ error: "payment_tx_failed" });
      return;
    }

    const paymentMessage = findBankPaymentMessage(
      txPayload,
      user.walletAddress,
      bankAddress,
      config.arkeoDenom
    );
    if (!paymentMessage) {
      res.status(400).json({ error: "payment_not_found" });
      return;
    }

    const requiredAmount = config.entryFeeUarkeo;
    if (paymentMessage.amount !== requiredAmount) {
      res.status(400).json({ error: "payment_amount_mismatch" });
      return;
    }

    await ensureBalance(user.id);

    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${race.id}))`;

        if (idempotencyKey) {
          const existing = await tx.ticketIdempotency.findUnique({
            where: {
              raceId_userId_key: { raceId: race.id, userId: user.id, key: idempotencyKey }
            }
          });
          if (existing) {
            return { response: existing.responseJson };
          }
        }

        const existingTx = await tx.ticket.findUnique({
          where: { paymentTxHash: normalizedTxHash }
        });
        if (existingTx) {
          throw new ConflictError("payment_tx_used");
        }

        const existingBet = await tx.ticket.findFirst({
          where: { raceId: race.id, userId: user.id }
        });
        if (existingBet) {
          throw new ConflictError("bet_already_placed");
        }

        const balance = await tx.balance.findUnique({ where: { userId: user.id } });
        const ticket = await tx.ticket.create({
          data: {
            raceId: race.id,
            userId: user.id,
            type: ticketType,
            costCredits,
            paymentTxHash: normalizedTxHash,
            paymentFromAddress: user.walletAddress,
            paymentToAddress: bankAddress,
            paymentDenom: config.arkeoDenom,
            paymentAmount: requiredAmount.toString(),
            paymentHeight: txResponse?.height ? Number(txResponse.height) : null,
            paymentTimestamp: txResponse?.timestamp ? new Date(txResponse.timestamp) : null
          }
        });

        const updatedRace = await tx.race.update({
          where: { id: race.id },
          data: { intakeCredits: { increment: costCredits } }
        });

        const payoutBudgetCredits = Math.floor(updatedRace.intakeCredits * config.payoutCapRatio);
        await tx.race.update({
          where: { id: race.id },
          data: { payoutBudgetCredits }
        });

        const response = {
          ticketId: ticket.id,
          userId: user.id,
          handle: user.handle,
          balance: balance?.credits ?? config.initialCredits
        };

        if (idempotencyKey) {
          await tx.ticketIdempotency.create({
            data: {
              raceId: race.id,
              userId: user.id,
              key: idempotencyKey,
              ticketId: ticket.id,
              responseJson: response
            }
          });
        }

        return { response };
      });

      if (!sessionToken || sessionToken !== user.sessionToken) {
        res.cookie("racing_session", user.sessionToken, sessionCookieOptions);
      }

      res.json(result.response);
    } catch (error: unknown) {
      if (idempotencyKey) {
        const existing = await prisma.ticketIdempotency.findUnique({
          where: {
            raceId_userId_key: { raceId: race.id, userId: user.id, key: idempotencyKey }
          }
        });
        if (existing) {
          res.json(existing.responseJson);
          return;
        }
      }
      throw error;
    }
  })
);

router.get(
  "/races/:raceId/selection",
  validate(getSelectionSchema),
  asyncHandler(async (req, res) => {
    const user = await requireSessionUser(req, res);
    if (!user) return;
    if (!user.walletAddress) {
      res.json({ selection: null });
      return;
    }

    const selection = await prisma.raceSelection.findUnique({
      where: { raceId_userId: { raceId: req.params.raceId, userId: user.id } }
    });

    res.json({
      selection: selection ? { raceHorseId: selection.raceHorseId } : null
    });
  })
);

router.post(
  "/races/:raceId/selection",
  validate(setSelectionSchema),
  asyncHandler(async (req, res) => {
    const { raceHorseId } = req.body as { raceHorseId: string };

    const race = await prisma.race.findUnique({ where: { id: req.params.raceId } });
    if (!race) {
      res.status(404).json({ error: "race_not_found" });
      return;
    }

    if (
      race.status === RaceStatus.running ||
      race.status === RaceStatus.finished ||
      race.status === RaceStatus.voided
    ) {
      res.status(400).json({ error: "picks_closed" });
      return;
    }

    const sessionToken = getSessionToken(req);
    if (!sessionToken) {
      res.status(401).json({ error: "session_required" });
      return;
    }

    const sessionKey = `session:${sessionToken}`;
    if (!checkRateLimit(sessionKey, RATE_LIMIT_MAX_REQUESTS, sessionWindowMs)) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { sessionToken } });
    if (!user) {
      res.status(401).json({ error: "session_invalid" });
      return;
    }

    if (!user.walletAddress) {
      res.status(400).json({ error: "wallet_not_linked" });
      return;
    }

    const raceHorse = await prisma.raceHorse.findFirst({
      where: { id: raceHorseId, raceId: race.id },
      include: { horse: true }
    });
    if (!raceHorse) {
      res.status(400).json({ error: "invalid_pick" });
      return;
    }

    // Check if this is a new selection or a change
    const existingSelection = await prisma.raceSelection.findUnique({
      where: { raceId_userId: { raceId: race.id, userId: user.id } }
    });
    const isNewSelection = !existingSelection || existingSelection.raceHorseId !== raceHorseId;

    const selection = await prisma.raceSelection.upsert({
      where: { raceId_userId: { raceId: race.id, userId: user.id } },
      update: { raceHorseId },
      create: { raceId: race.id, userId: user.id, raceHorseId }
    });

    // Broadcast to chat if this is a new/changed selection
    if (isNewSelection) {
      const displayName = user.nickname || user.handle;
      const message = getRandomSelectionMessage(displayName, raceHorse.horse.displayName);
      broadcastToChat({
        type: "chat_message",
        data: {
          id: `selection-${selection.id}`,
          text: message,
          createdAt: new Date().toISOString(),
          user: { id: "system", displayName: "Race Announcer" }
        }
      });
    }

    res.json({ selection: { raceHorseId: selection.raceHorseId } });
  })
);

router.delete(
  "/races/:raceId/selection",
  validate(deleteSelectionSchema),
  asyncHandler(async (req, res) => {
    const race = await prisma.race.findUnique({ where: { id: req.params.raceId } });
    if (!race) {
      res.status(404).json({ error: "race_not_found" });
      return;
    }

    if (race.status !== RaceStatus.picking || new Date() >= race.pickCloseAt) {
      res.status(400).json({ error: "picks_closed" });
      return;
    }

    const sessionToken = getSessionToken(req);
    if (!sessionToken) {
      res.status(401).json({ error: "session_required" });
      return;
    }

    const sessionKey = `session:${sessionToken}`;
    if (!checkRateLimit(sessionKey, RATE_LIMIT_MAX_REQUESTS, sessionWindowMs)) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { sessionToken } });
    if (!user) {
      res.status(401).json({ error: "session_invalid" });
      return;
    }

    const existingSelection = await prisma.raceSelection.findUnique({
      where: { raceId_userId: { raceId: race.id, userId: user.id } }
    });

    if (!existingSelection) {
      res.json({ selection: null });
      return;
    }

    await prisma.raceSelection.delete({ where: { id: existingSelection.id } });
    res.json({ selection: null });
  })
);

router.get(
  "/races/:raceId/selections",
  validate(getSelectionsSchema),
  asyncHandler(async (req, res) => {
    const selections = await prisma.raceSelection.findMany({
      where: { raceId: req.params.raceId },
      include: {
        user: true,
        raceHorse: { include: { horse: true, serviceType: true } }
      },
      orderBy: { createdAt: "asc" }
    });

    res.json({
      selections: selections.map((selection) => ({
        selectionId: selection.id,
        createdAt: selection.createdAt,
        raceHorseId: selection.raceHorseId,
        bettor: {
          nickname: selection.user.nickname,
          walletAddress: selection.user.walletAddress
        },
        picks: [
          {
            horseName: selection.raceHorse.horse.displayName,
            serviceType: selection.raceHorse.serviceType.displayName
          }
        ],
        type: "single"
      }))
    });
  })
);

router.post(
  "/races/:raceId/picks",
  validate(submitPicksSchema),
  asyncHandler(async (req, res) => {
    const { ticketId, raceHorseIds } = req.body as {
      ticketId: string;
      raceHorseIds: string[];
    };

    const race = await prisma.race.findUnique({ where: { id: req.params.raceId } });
    if (!race) {
      res.status(404).json({ error: "race_not_found" });
      return;
    }

    if (race.status !== RaceStatus.picking || new Date() >= race.pickCloseAt) {
      res.status(400).json({ error: "picks_closed" });
      return;
    }

    const sessionToken = getSessionToken(req);
    if (!sessionToken) {
      res.status(401).json({ error: "session_required" });
      return;
    }

    const sessionKey = `session:${sessionToken}`;
    if (!checkRateLimit(sessionKey, RATE_LIMIT_MAX_REQUESTS, sessionWindowMs)) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { sessionToken } });
    if (!user) {
      res.status(401).json({ error: "session_invalid" });
      return;
    }

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { picks: true } });
    if (!ticket || ticket.raceId !== race.id) {
      res.status(404).json({ error: "ticket_not_found" });
      return;
    }

    if (ticket.userId !== user.id) {
      res.status(403).json({ error: "ticket_owner_mismatch" });
      return;
    }

    if (ticket.picks.length > 0) {
      res.status(400).json({ error: "picks_already_submitted" });
      return;
    }

    if (ticket.type !== TicketType.single) {
      res.status(400).json({ error: "invalid_ticket_type" });
      return;
    }

    const expectedCount = 1;
    const uniqueIds = Array.from(new Set(raceHorseIds));

    if (uniqueIds.length !== expectedCount) {
      res.status(400).json({ error: "invalid_pick_count" });
      return;
    }

    const raceHorses = await prisma.raceHorse.findMany({
      where: { raceId: race.id, id: { in: uniqueIds } }
    });

    if (raceHorses.length !== expectedCount) {
      res.status(400).json({ error: "invalid_picks" });
      return;
    }

    await prisma.pick.createMany({
      data: uniqueIds.map((raceHorseId) => ({ ticketId, raceHorseId }))
    });

    res.json({ ok: true });
  })
);

export default router;

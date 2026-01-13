import { Router } from "express";
import { prisma } from "../db";
import { config } from "../config";
import { containsProfanity } from "../profanity";
import { asyncHandler } from "./utils/asyncHandler";
import { isValidWalletAddress, isValidNickname } from "./utils/validators";
import { normalizeWalletAddress, normalizeNickname, normalizeNicknameKey } from "./utils/normalizers";
import { fetchArkeoBalance } from "./utils/arkeo";
import { getOrCreateUser, requireSessionUser, getSessionToken } from "./utils/session";
import { sessionCookieOptions } from "./utils/cookies";

const router = Router();

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const sessionToken = getSessionToken(req);
    let user = sessionToken
      ? await prisma.user.findUnique({ where: { sessionToken } })
      : null;
    if (!user) {
      user = await getOrCreateUser({ sessionToken });
      res.cookie("racing_session", user.sessionToken, sessionCookieOptions);
    }
    const balance = await prisma.balance.findUnique({ where: { userId: user.id } });
    res.json({
      userId: user.id,
      handle: user.handle,
      nickname: user.nickname,
      walletAddress: user.walletAddress,
      balance: balance?.credits ?? 0,
      // Include session token for Safari fallback (stored in localStorage)
      sessionToken: user.sessionToken
    });
  })
);

router.get(
  "/me/wallet",
  asyncHandler(async (req, res) => {
    const user = await requireSessionUser(req, res);
    if (!user) return;
    res.json({
      walletAddress: user.walletAddress,
      nickname: user.nickname,
      chain: {
        chainId: config.arkeoChainId,
        chainName: config.arkeoChainName,
        rpcUrl: config.arkeoRpcUrl,
        restUrl: config.arkeoRestUrl,
        denom: config.arkeoDenom,
        decimals: config.arkeoDecimals,
        ticker: config.arkeoTicker,
        bech32Prefix: config.arkeoBech32Prefix
      }
    });
  })
);

router.post(
  "/me/wallet",
  asyncHandler(async (req, res) => {
    const walletAddressRaw = req.body?.walletAddress as string | undefined;
    const nicknameRaw = req.body?.nickname as string | undefined;
    const walletAddress = normalizeWalletAddress(walletAddressRaw);
    const nickname = normalizeNickname(nicknameRaw);
    const nicknameKey = nickname ? normalizeNicknameKey(nickname) : undefined;

    if (!walletAddress || !isValidWalletAddress(walletAddress)) {
      res.status(400).json({ error: "invalid_wallet_address" });
      return;
    }
    if (nickname && !isValidNickname(nickname)) {
      res.status(400).json({ error: "invalid_nickname" });
      return;
    }
    if (nickname && containsProfanity(nickname)) {
      res.status(400).json({ error: "profanity_detected" });
      return;
    }

    const sessionToken = getSessionToken(req);
    let user = sessionToken
      ? await prisma.user.findUnique({ where: { sessionToken } })
      : null;

    const existingWallet = await prisma.user.findUnique({ where: { walletAddress } });
    if (existingWallet && (!user || existingWallet.id !== user.id)) {
      user = existingWallet;
    }

    if (!user) {
      user = await getOrCreateUser({ sessionToken });
    }

    if (nickname && nicknameKey) {
      const existingNickname = await prisma.user.findUnique({
        where: { nicknameLower: nicknameKey }
      });
      if (existingNickname && existingNickname.id !== user.id) {
        res.status(409).json({ error: "nickname_taken" });
        return;
      }
    }

    const shouldUpdate =
      user.walletAddress !== walletAddress ||
      (nickname && (user.nickname !== nickname || user.nicknameLower !== nicknameKey));

    const updated = shouldUpdate
      ? await prisma.user.update({
          where: { id: user.id },
          data: {
            walletAddress,
            ...(nickname ? { nickname, nicknameLower: nicknameKey } : {})
          }
        })
      : user;

    if (!sessionToken || sessionToken !== updated.sessionToken) {
      res.cookie("racing_session", updated.sessionToken, sessionCookieOptions);
    }

    // Fetch balance and onchain balance to avoid Safari cookie timing issues
    const balance = await prisma.balance.findUnique({ where: { userId: updated.id } });
    let onchainBalance: { displayAmount: string; ticker: string } | null = null;
    try {
      onchainBalance = await fetchArkeoBalance(walletAddress);
    } catch {
      // Balance fetch failed, but we can still return the user data
    }

    res.json({
      userId: updated.id,
      walletAddress: updated.walletAddress,
      nickname: updated.nickname,
      credits: balance?.credits ?? 0,
      onchainBalance: onchainBalance
        ? { displayAmount: onchainBalance.displayAmount, ticker: onchainBalance.ticker }
        : null,
      // Include session token for Safari fallback
      sessionToken: updated.sessionToken
    });
  })
);

router.post(
  "/me/wallet/disconnect",
  asyncHandler(async (_req, res) => {
    res.clearCookie("racing_session", sessionCookieOptions);
    res.json({ ok: true });
  })
);

router.post(
  "/me/nickname",
  asyncHandler(async (req, res) => {
    const nicknameRaw = req.body?.nickname as string | undefined;
    const nickname = normalizeNickname(nicknameRaw);
    const nicknameKey = nickname ? normalizeNicknameKey(nickname) : undefined;
    if (!nickname || !isValidNickname(nickname)) {
      res.status(400).json({ error: "invalid_nickname" });
      return;
    }
    if (containsProfanity(nickname)) {
      res.status(400).json({ error: "profanity_detected" });
      return;
    }
    const user = await requireSessionUser(req, res);
    if (!user) return;
    if (nicknameKey) {
      const existingNickname = await prisma.user.findUnique({
        where: { nicknameLower: nicknameKey }
      });
      if (existingNickname && existingNickname.id !== user.id) {
        res.status(409).json({ error: "nickname_taken" });
        return;
      }
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { nickname, nicknameLower: nicknameKey }
    });
    res.json({ nickname: updated.nickname });
  })
);

router.get(
  "/me/wallet/balance",
  asyncHandler(async (req, res) => {
    const user = await requireSessionUser(req, res);
    if (!user) return;
    if (!user.walletAddress) {
      res.status(400).json({ error: "wallet_not_linked" });
      return;
    }
    try {
      const balance = await fetchArkeoBalance(user.walletAddress);
      res.json({
        address: user.walletAddress,
        ...balance
      });
    } catch {
      res.status(502).json({ error: "balance_unavailable" });
    }
  })
);

export default router;

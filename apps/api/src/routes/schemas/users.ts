import { z } from "zod";
import { walletAddressSchema, nicknameSchema } from "./common";

// POST /me/wallet - Link wallet address
export const linkWalletSchema = z.object({
  body: z.object({
    walletAddress: walletAddressSchema,
    nickname: nicknameSchema.optional()
  })
});

// POST /me/nickname - Update nickname
export const updateNicknameSchema = z.object({
  body: z.object({
    nickname: nicknameSchema
  })
});

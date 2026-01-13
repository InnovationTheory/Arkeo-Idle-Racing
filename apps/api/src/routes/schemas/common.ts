import { z } from "zod";

// UUID parameter validation
export const uuidParam = z.string().uuid();

// Pagination query parameters
export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});

// Handle validation (alphanumeric, underscore, dash, 3-20 chars)
export const handleSchema = z
  .string()
  .min(3, "Handle must be at least 3 characters")
  .max(20, "Handle must be at most 20 characters")
  .regex(/^[a-zA-Z0-9_-]+$/, "Handle can only contain letters, numbers, underscores, and dashes");

// Nickname validation (3-24 chars, allows spaces)
export const nicknameSchema = z
  .string()
  .min(3, "Nickname must be at least 3 characters")
  .max(24, "Nickname must be at most 24 characters")
  .regex(/^[a-zA-Z0-9_ -]+$/, "Nickname can only contain letters, numbers, spaces, underscores, and dashes");

// Wallet address validation (Arkeo bech32 format)
export const walletAddressSchema = z
  .string()
  .regex(/^arkeo1[a-z0-9]{38,58}$/i, "Invalid Arkeo wallet address format");

// Transaction hash validation (64 uppercase hex characters)
export const txHashSchema = z
  .string()
  .regex(/^[A-F0-9]{64}$/, "Transaction hash must be 64 uppercase hex characters");

// Race ID parameter schema
export const raceIdParam = z.object({
  params: z.object({
    raceId: uuidParam
  })
});

// Race day ID parameter schema
export const raceDayIdParam = z.object({
  params: z.object({
    id: uuidParam
  })
});

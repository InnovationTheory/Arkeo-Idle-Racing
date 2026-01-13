import { config } from "../../config";
import { NotFoundError, ServiceError } from "../../errors";
import { ArkeoTxResponse } from "../../types/arkeo";

export type ArkeoBalance = {
  denom: string;
  amount: string;
  displayAmount: string;
  decimals: number;
  ticker: string;
};

export function formatUnits(amount: string, decimals: number): string {
  if (!amount) return "0";
  if (decimals <= 0) return amount;
  const padded = amount.padStart(decimals + 1, "0");
  const integer = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

export async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function fetchArkeoBalance(address: string): Promise<ArkeoBalance> {
  const url = new URL(config.arkeoRestUrl);
  url.pathname = `/cosmos/bank/v1beta1/balances/${address}`;
  const response = await fetchWithTimeout(url.toString(), 5000);
  if (!response.ok) {
    throw new ServiceError("balance_unavailable");
  }
  const payload = (await response.json()) as {
    balances?: Array<{ denom?: string; amount?: string }>;
  };
  const match = payload.balances?.find((entry) => entry?.denom === config.arkeoDenom);
  const amount = match?.amount ?? "0";
  return {
    denom: config.arkeoDenom,
    amount,
    displayAmount: formatUnits(amount, config.arkeoDecimals),
    decimals: config.arkeoDecimals,
    ticker: config.arkeoTicker
  };
}

export async function fetchArkeoTx(txHash: string): Promise<ArkeoTxResponse> {
  const url = new URL(config.arkeoRestUrl);
  url.pathname = `/cosmos/tx/v1beta1/txs/${txHash}`;
  const response = await fetchWithTimeout(url.toString(), 7000);
  if (!response.ok) {
    throw new NotFoundError("tx_not_found");
  }
  return (await response.json()) as ArkeoTxResponse;
}

export function findBankPaymentMessage(
  tx: ArkeoTxResponse,
  fromAddress: string,
  toAddress: string,
  denom: string
): { amount: bigint } | null {
  const messages = tx?.tx?.body?.messages ?? tx?.tx_body?.messages ?? [];
  for (const message of messages) {
    const msgType =
      message?.["@type"] ||
      message?.typeUrl ||
      message?.type ||
      message?.type_url ||
      "";
    if (
      msgType !== "/cosmos.bank.v1beta1.MsgSend" &&
      msgType !== "cosmos.bank.v1beta1.MsgSend"
    ) {
      continue;
    }
    const from = message?.from_address ?? message?.fromAddress;
    const to = message?.to_address ?? message?.toAddress;
    if (!from || !to) continue;
    if (from.toLowerCase() !== fromAddress.toLowerCase()) continue;
    if (to.toLowerCase() !== toAddress.toLowerCase()) continue;
    const amounts = message?.amount ?? [];
    for (const entry of amounts) {
      if (entry?.denom !== denom) continue;
      try {
        const amount = BigInt(entry?.amount ?? "0");
        return { amount };
      } catch {
        return null;
      }
    }
  }
  return null;
}


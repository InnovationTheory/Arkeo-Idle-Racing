import { SigningStargateClient, GasPrice, calculateFee, coin } from "@cosmjs/stargate";
import type { OfflineSigner } from "@cosmjs/proto-signing";

const chainId = import.meta.env.VITE_ARKEO_CHAIN_ID || "arkeo-main-v1";
const chainName = import.meta.env.VITE_ARKEO_CHAIN_NAME || "Arkeo";
const rpcUrl = import.meta.env.VITE_ARKEO_RPC_URL || "https://rpc-seed.arkeo.network";
const restUrl = import.meta.env.VITE_ARKEO_LCD_URL || "https://rest-seed.arkeo.network";
const denom = import.meta.env.VITE_ARKEO_DENOM || "uarkeo";
const ticker = import.meta.env.VITE_ARKEO_TICKER || "ARKEO";
const decimalsRaw = Number(import.meta.env.VITE_ARKEO_DECIMALS ?? 8);
const decimals = Number.isFinite(decimalsRaw) ? decimalsRaw : 8;
const bech32Prefix = (import.meta.env.VITE_ARKEO_BECH32_PREFIX || "arkeo").toLowerCase();
const gasPrice = import.meta.env.VITE_ARKEO_GAS_PRICE || "0.025uarkeo";
const gasLimitRaw = Number(import.meta.env.VITE_ARKEO_GAS_LIMIT ?? 200000);
const gasLimit = Number.isFinite(gasLimitRaw) ? gasLimitRaw : 200000;

export const arkeoChainMeta = {
  chainId,
  chainName,
  rpcUrl,
  restUrl,
  denom,
  decimals,
  ticker,
  bech32Prefix
};

export const arkeoChainInfo = {
  chainId,
  chainName,
  rpc: rpcUrl,
  rest: restUrl,
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: bech32Prefix,
    bech32PrefixAccPub: `${bech32Prefix}pub`,
    bech32PrefixValAddr: `${bech32Prefix}valoper`,
    bech32PrefixValPub: `${bech32Prefix}valoperpub`,
    bech32PrefixConsAddr: `${bech32Prefix}valcons`,
    bech32PrefixConsPub: `${bech32Prefix}valconspub`
  },
  stakeCurrency: {
    coinDenom: ticker,
    coinMinimalDenom: denom,
    coinDecimals: decimals
  },
  currencies: [
    {
      coinDenom: ticker,
      coinMinimalDenom: denom,
      coinDecimals: decimals
    }
  ],
  feeCurrencies: [
    {
      coinDenom: ticker,
      coinMinimalDenom: denom,
      coinDecimals: decimals
    }
  ],
  features: ["stargate", "ibc-transfer"]
};

export async function connectKeplr(): Promise<string> {
  if (!window.keplr) {
    throw new Error("keplr_not_found");
  }

  if (window.keplr.experimentalSuggestChain) {
    await window.keplr.experimentalSuggestChain(arkeoChainInfo);
  }
  await window.keplr.enable(chainId);
  const key = await window.keplr.getKey(chainId);
  return key.bech32Address;
}

async function getOfflineSigner(): Promise<OfflineSigner> {
  if (!window.keplr) {
    throw new Error("keplr_not_found");
  }
  if (window.keplr.getOfflineSignerAuto) {
    return (await window.keplr.getOfflineSignerAuto(chainId)) as OfflineSigner;
  }
  if (window.keplr.getOfflineSigner) {
    return window.keplr.getOfflineSigner(chainId) as OfflineSigner;
  }
  throw new Error("keplr_not_found");
}

export async function sendStakePayment(toAddress: string, amount: string): Promise<string> {
  await connectKeplr();
  const signer = await getOfflineSigner();
  const accounts = await signer.getAccounts();
  const sender = accounts[0]?.address;
  if (!sender) {
    throw new Error("wallet_not_ready");
  }

  const fee = calculateFee(gasLimit, GasPrice.fromString(gasPrice));
  const client = await SigningStargateClient.connectWithSigner(rpcUrl, signer, {
    gasPrice: GasPrice.fromString(gasPrice)
  });
  const response = await client.sendTokens(sender, toAddress, [coin(amount, denom)], fee);
  if (response.code && response.code !== 0) {
    throw new Error("tx_failed");
  }
  return response.transactionHash;
}

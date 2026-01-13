import { SigningStargateClient, GasPrice } from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { config } from "../config";

type SendResult = {
  ok: boolean;
  txHash?: string;
  error?: string;
};

let cachedClient: SigningStargateClient | null = null;
let cachedAddress: string | null = null;

async function getSigningClient(): Promise<{ client: SigningStargateClient; address: string } | null> {
  if (cachedClient && cachedAddress) {
    return { client: cachedClient, address: cachedAddress };
  }

  const mnemonic = config.hotWalletMnemonic;
  if (!mnemonic) {
    return null;
  }

  try {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: config.arkeoBech32Prefix
    });
    const [account] = await wallet.getAccounts();

    const client = await SigningStargateClient.connectWithSigner(
      config.arkeoRpcUrl,
      wallet,
      { gasPrice: GasPrice.fromString(config.arkeoGasPrice) }
    );

    cachedClient = client;
    cachedAddress = account.address;

    return { client, address: account.address };
  } catch (error) {
    console.error("Failed to initialize signing client:", error);
    return null;
  }
}

export async function getHotWalletAddress(): Promise<string | null> {
  const mnemonic = config.hotWalletMnemonic;
  if (!mnemonic) {
    return null;
  }

  if (cachedAddress) {
    return cachedAddress;
  }

  try {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: config.arkeoBech32Prefix
    });
    const [account] = await wallet.getAccounts();
    cachedAddress = account.address;
    return account.address;
  } catch {
    return null;
  }
}

export async function sendArkeoReward(params: {
  toAddress: string;
  amountUarkeo: bigint;
  memo?: string;
}): Promise<SendResult> {
  const signingClient = await getSigningClient();
  if (!signingClient) {
    return { ok: false, error: "hot_wallet_not_configured" };
  }

  const { client, address } = signingClient;
  const amount = {
    denom: config.arkeoDenom,
    amount: params.amountUarkeo.toString()
  };

  try {
    const result = await client.sendTokens(
      address,
      params.toAddress,
      [amount],
      "auto",
      params.memo
    );

    if (result.code === 0) {
      return { ok: true, txHash: result.transactionHash };
    } else {
      return { ok: false, error: `tx_failed_code_${result.code}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

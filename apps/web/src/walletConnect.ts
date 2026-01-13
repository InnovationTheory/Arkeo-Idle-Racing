import SignClient from "@walletconnect/sign-client";
import { WalletConnectModal } from "@walletconnect/modal";
import type { SessionTypes } from "@walletconnect/types";
import type { OfflineSigner } from "@cosmjs/proto-signing";
import { SigningStargateClient, GasPrice, calculateFee, coin } from "@cosmjs/stargate";
import { arkeoChainMeta } from "./keplr";

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
const chainId = arkeoChainMeta.chainId;
const caipChainId = `cosmos:${chainId}`;

let signClient: SignClient | null = null;
let signClientPromise: Promise<SignClient> | null = null;
let wcModal: WalletConnectModal | null = null;
let currentSession: SessionTypes.Struct | null = null;

const STORAGE_KEY_SESSION = "arkeo_wc_session";
const STORAGE_KEY_TOPIC = "arkeo_wc_topic";

async function getSignClient(): Promise<SignClient> {
  // Return existing client
  if (signClient) return signClient;

  // Return pending initialization (prevents double init)
  if (signClientPromise) return signClientPromise;

  // Start new initialization
  signClientPromise = SignClient.init({
    projectId,
    metadata: {
      name: "Arkeo Racing",
      description: "Decentralized horse racing on Arkeo",
      url: window.location.origin,
      icons: [`${window.location.origin}/arkeo-icon.png`]
    }
  }).then((client) => {
    signClient = client;

    // Handle session events
    client.on("session_delete", () => {
      currentSession = null;
      localStorage.removeItem(STORAGE_KEY_SESSION);
      localStorage.removeItem(STORAGE_KEY_TOPIC);
    });

    client.on("session_expire", () => {
      currentSession = null;
      localStorage.removeItem(STORAGE_KEY_SESSION);
      localStorage.removeItem(STORAGE_KEY_TOPIC);
    });

    return client;
  });

  return signClientPromise;
}

function getModal(): WalletConnectModal {
  if (wcModal) return wcModal;

  wcModal = new WalletConnectModal({
    projectId,
    chains: [caipChainId],
    themeMode: "light"
  });

  return wcModal;
}

export async function connectWalletConnect(): Promise<string> {
  const client = await getSignClient();
  const modal = getModal();

  // Try to restore existing session
  const savedTopic = localStorage.getItem(STORAGE_KEY_TOPIC);
  if (savedTopic) {
    const sessions = client.session.getAll();
    const existingSession = sessions.find(s => s.topic === savedTopic);
    if (existingSession) {
      currentSession = existingSession;
      const accounts = existingSession.namespaces.cosmos?.accounts ?? [];
      const address = accounts[0]?.split(":")[2];
      if (address) return address;
    }
  }

  // Create new connection
  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      cosmos: {
        methods: ["cosmos_getAccounts", "cosmos_signDirect", "cosmos_signAmino"],
        chains: [caipChainId],
        events: ["chainChanged", "accountsChanged"]
      }
    }
  });

  if (!uri) {
    throw new Error("walletconnect_no_uri");
  }

  // Open modal with QR code
  await modal.openModal({ uri });

  try {
    const session = await approval();
    currentSession = session;

    // Store session for reconnection
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    localStorage.setItem(STORAGE_KEY_TOPIC, session.topic);

    modal.closeModal();

    // Extract address from session
    const accounts = session.namespaces.cosmos?.accounts ?? [];
    const address = accounts[0]?.split(":")[2];

    if (!address) {
      throw new Error("walletconnect_no_address");
    }

    return address;
  } catch (error) {
    modal.closeModal();
    throw error;
  }
}

export async function restoreWalletConnectSession(): Promise<string | null> {
  try {
    const client = await getSignClient();
    const savedTopic = localStorage.getItem(STORAGE_KEY_TOPIC);

    if (!savedTopic) return null;

    const sessions = client.session.getAll();
    const existingSession = sessions.find(s => s.topic === savedTopic);

    if (!existingSession) {
      localStorage.removeItem(STORAGE_KEY_SESSION);
      localStorage.removeItem(STORAGE_KEY_TOPIC);
      return null;
    }

    currentSession = existingSession;
    const accounts = existingSession.namespaces.cosmos?.accounts ?? [];
    const address = accounts[0]?.split(":")[2];

    return address || null;
  } catch {
    return null;
  }
}

export async function disconnectWalletConnect(): Promise<void> {
  if (!currentSession) return;

  try {
    const client = await getSignClient();
    await client.disconnect({
      topic: currentSession.topic,
      reason: { code: 6000, message: "User disconnected" }
    });
  } catch {
    // Ignore disconnect errors
  }

  currentSession = null;
  localStorage.removeItem(STORAGE_KEY_SESSION);
  localStorage.removeItem(STORAGE_KEY_TOPIC);
}

export function getWalletConnectSigner(): OfflineSigner {
  if (!currentSession) {
    throw new Error("walletconnect_not_connected");
  }

  const topic = currentSession.topic;
  const accounts = currentSession.namespaces.cosmos?.accounts ?? [];
  const address = accounts[0]?.split(":")[2];

  if (!address) {
    throw new Error("walletconnect_no_address");
  }

  return {
    getAccounts: async () => {
      return [
        {
          address,
          algo: "secp256k1" as const,
          pubkey: new Uint8Array() // WalletConnect doesn't expose pubkey directly
        }
      ];
    },

    signDirect: async (signerAddress: string, signDoc: any) => {
      const client = await getSignClient();

      const result = await client.request<{
        signature: { signature: string; pub_key: { type: string; value: string } };
        signed: any;
      }>({
        topic,
        chainId: caipChainId,
        request: {
          method: "cosmos_signDirect",
          params: {
            signerAddress,
            signDoc: {
              chainId: signDoc.chainId,
              accountNumber: signDoc.accountNumber.toString(),
              authInfoBytes: Buffer.from(signDoc.authInfoBytes).toString("base64"),
              bodyBytes: Buffer.from(signDoc.bodyBytes).toString("base64")
            }
          }
        }
      });

      return {
        signature: {
          signature: result.signature.signature,
          pub_key: result.signature.pub_key
        },
        signed: signDoc
      };
    }
  } as OfflineSigner;
}

export async function sendWalletConnectPayment(
  toAddress: string,
  amount: string
): Promise<string> {
  const signer = getWalletConnectSigner();
  const accounts = await signer.getAccounts();
  const sender = accounts[0]?.address;

  if (!sender) {
    throw new Error("wallet_not_ready");
  }

  const gasPrice = import.meta.env.VITE_ARKEO_GAS_PRICE || "0.025uarkeo";
  const gasLimitRaw = Number(import.meta.env.VITE_ARKEO_GAS_LIMIT ?? 200000);
  const gasLimit = Number.isFinite(gasLimitRaw) ? gasLimitRaw : 200000;
  const denom = arkeoChainMeta.denom;

  const fee = calculateFee(gasLimit, GasPrice.fromString(gasPrice));
  const client = await SigningStargateClient.connectWithSigner(
    arkeoChainMeta.rpcUrl,
    signer,
    { gasPrice: GasPrice.fromString(gasPrice) }
  );

  const response = await client.sendTokens(sender, toAddress, [coin(amount, denom)], fee);

  if (response.code && response.code !== 0) {
    throw new Error("tx_failed");
  }

  return response.transactionHash;
}

export function isWalletConnectConnected(): boolean {
  return currentSession !== null;
}

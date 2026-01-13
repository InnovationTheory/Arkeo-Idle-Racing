export {};

type KeplrKey = {
  bech32Address: string;
};

type KeplrAccount = {
  address: string;
};

type KeplrOfflineSigner = {
  getAccounts: () => Promise<KeplrAccount[]>;
};

type KeplrInstance = {
  enable: (chainId: string) => Promise<void>;
  getKey: (chainId: string) => Promise<KeplrKey>;
  getOfflineSigner?: (chainId: string) => KeplrOfflineSigner;
  getOfflineSignerAuto?: (chainId: string) => Promise<KeplrOfflineSigner>;
  experimentalSuggestChain?: (chainInfo: Record<string, unknown>) => Promise<void>;
};

declare global {
  interface Window {
    keplr?: KeplrInstance;
  }
}

export type ArkeoTxMessage = {
  "@type"?: string;
  typeUrl?: string;
  type?: string;
  type_url?: string;
  from_address?: string;
  fromAddress?: string;
  to_address?: string;
  toAddress?: string;
  amount?: Array<{ denom?: string; amount?: string }>;
};

export type ArkeoTxResponse = {
  tx?: {
    body?: { messages?: ArkeoTxMessage[] };
  };
  tx_body?: { messages?: ArkeoTxMessage[] };
  tx_response?: {
    code?: number;
    txhash?: string;
    height?: number | string;
    timestamp?: string;
  };
  txResponse?: {
    code?: number;
    txhash?: string;
    height?: number | string;
    timestamp?: string;
  };
};

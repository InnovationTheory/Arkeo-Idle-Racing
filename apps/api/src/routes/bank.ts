import { Router } from "express";
import { config } from "../config";
import { asyncHandler } from "./utils/asyncHandler";
import { isValidWalletAddress } from "./utils/validators";
import { fetchArkeoBalance } from "./utils/arkeo";
import { getHotWalletAddress } from "../arkeo/send";

const router = Router();

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    if (!config.hotWalletEnabled) {
      res.status(404).json({ error: "bank_unavailable" });
      return;
    }

    const address = await getHotWalletAddress();
    if (!address || !isValidWalletAddress(address)) {
      res.status(404).json({ error: "bank_unavailable" });
      return;
    }

    let balance = null;
    try {
      balance = await fetchArkeoBalance(address);
    } catch {
      balance = null;
    }

    res.json({
      address,
      entryFeeUarkeo: config.entryFeeUarkeo.toString(),
      pick3FeeUarkeo: config.pick3FeeUarkeo.toString(),
      balance,
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

export default router;

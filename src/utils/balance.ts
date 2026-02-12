/**
 * Shared balance checking utility.
 *
 * Extracted from swap.ts and bridge.ts to avoid duplication.
 */

import {
  getBalances,
  getTokenBalance,
  resolveToken,
  type SupportedChain,
} from "../para/client.js";
import { parseAndValidateAmount } from "./validators.js";

export interface BalanceCheckResult {
  sufficient: boolean;
  balance: string;
}

/**
 * Check if the user has enough of a token on a given chain.
 * Works for both native tokens (ETH, MATIC) and ERC-20s.
 */
export async function checkBalance(
  token: string,
  amount: string,
  chain: SupportedChain,
  address: string
): Promise<BalanceCheckResult> {
  const amountCheck = parseAndValidateAmount(amount);
  const amountNum = amountCheck.valid ? amountCheck.value : parseFloat(amount);

  // Check native token balance
  const nativeSymbols = ["ETH", "MATIC", "NATIVE"];
  if (nativeSymbols.includes(token.toUpperCase())) {
    const balances = await getBalances(chain);
    const balance = parseFloat(balances[0]?.balance || "0");
    return {
      sufficient: balance >= amountNum,
      balance: balances[0]?.balance || "0",
    };
  }

  // Check ERC-20 token balance
  try {
    let tokenAddress: string;
    if (token.startsWith("0x")) {
      tokenAddress = token;
    } else {
      const resolved = resolveToken(token, chain);
      if (!resolved) {
        return { sufficient: false, balance: "0" };
      }
      tokenAddress = resolved.address;
    }

    const tokenBalance = await getTokenBalance(tokenAddress, chain, address);
    const balance = parseFloat(tokenBalance.balance);
    return {
      sufficient: balance >= amountNum,
      balance: tokenBalance.balance,
    };
  } catch {
    return { sufficient: false, balance: "0" };
  }
}

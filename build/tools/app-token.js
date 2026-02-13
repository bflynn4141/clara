/**
 * App Token Tools - Tokenize your apps with bonding curves and revenue sharing
 *
 * Tools:
 * - wallet_create_app_token: Deploy a new app token
 * - wallet_buy_app_token: Buy tokens on the bonding curve
 * - wallet_sell_app_token: Sell tokens back to the curve
 * - wallet_claim_dividends: Withdraw your revenue share
 * - wallet_app_token_info: View token stats and your position
 */
import { z } from "zod";
import { getSession } from "../storage/session.js";
import { sendTransaction, } from "../para/client.js";
import { ethers } from "ethers";
// Contract ABIs (simplified for the functions we need)
const FACTORY_ABI = [
    "function createTokenSimple(string name, string symbol, uint256 maxSupply, uint256 targetRaiseEth, uint256 creatorShareBps, string appDescription, string appUrl) returns (address)",
    "function getTokensByCreator(address creator) view returns (address[])",
    "function getRecentTokens(uint256 count) view returns (address[])",
    "function previewStandardCurve(uint256 maxSupply, uint256 targetRaise) view returns (tuple(uint128 rangeTo, uint128 pricePerToken)[])",
];
const TOKEN_ABI = [
    "function buy(uint256 minTokensOut) payable",
    "function sell(uint256 tokenAmount, uint256 minEthOut)",
    "function withdrawDividend()",
    "function distributeRevenue() payable",
    "function quoteBuy(uint256 ethIn) view returns (uint256 tokensOut, uint256 ethCost, uint256 fee)",
    "function quoteSell(uint256 tokenAmount) view returns (uint256 ethOut, uint256 fee, uint256 toSeller)",
    "function progress() view returns (uint256 percentSold, uint256 tokensSold, uint256 tokensRemaining, uint256 ethRaised)",
    "function dividendInfo(address holder) view returns (uint256 withdrawable, uint256 withdrawn, uint256 eligibleBal, uint256 eligibleTimestamp)",
    "function currentPrice() view returns (uint256)",
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function maxSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function reserveEth() view returns (uint256)",
    "function dividendEth() view returns (uint256)",
    "function totalDividendsDistributed() view returns (uint256)",
    "function creator() view returns (address)",
    "function state() view returns (uint8)",
    "function appDescription() view returns (string)",
    "function appUrl() view returns (string)",
];
// Factory addresses by chain (to be deployed)
const FACTORY_ADDRESSES = {
    base: "", // TODO: Deploy and add address
    "base-sepolia": "", // TODO: Deploy and add address
};
const SUPPORTED_CHAINS = ["base"];
// RPC URLs
const RPC_URLS = {
    base: "https://mainnet.base.org",
    "base-sepolia": "https://sepolia.base.org",
};
/**
 * Get ethers provider for a chain
 */
function getProvider(chain) {
    const rpcUrl = RPC_URLS[chain];
    if (!rpcUrl)
        throw new Error(`Unsupported chain: ${chain}`);
    return new ethers.JsonRpcProvider(rpcUrl);
}
/**
 * Register all app token tools
 */
export function registerAppTokenTools(server) {
    // ═══════════════════════════════════════════════════════════════════════
    // wallet_create_app_token
    // ═══════════════════════════════════════════════════════════════════════
    server.registerTool("wallet_create_app_token", {
        description: `Create a tokenized app with bonding curve and revenue sharing.

**What this does:**
- Deploys a token for your app (e.g., $SWAP for SwapMaster)
- Sets up a bonding curve where early buyers get better prices
- Enables automatic dividend distribution to token holders

**Example:**
"Create a token for my swap aggregator. Call it SwapMaster ($SWAP), raise 10 ETH, I keep 20% of revenue."

**After creation:**
- Share the token address with potential investors
- They can buy tokens via wallet_buy_app_token
- When your app earns revenue, call wallet_distribute_revenue
- Token holders automatically earn their share`,
        inputSchema: {
            name: z.string().describe("Token name (e.g., 'SwapMaster Token')"),
            symbol: z.string().describe("Token symbol (e.g., 'SWAP')"),
            targetRaiseEth: z.string().describe("Target ETH to raise (e.g., '10' for 10 ETH)"),
            creatorSharePercent: z.number().min(5).max(50).default(20)
                .describe("Your share of revenue (5-50%, default 20%)"),
            description: z.string().describe("Short description of your app"),
            url: z.string().optional().describe("URL to your app"),
            chain: z.enum(SUPPORTED_CHAINS).default("base").describe("Chain to deploy on"),
        },
    }, async (args) => {
        const { name, symbol, targetRaiseEth, creatorSharePercent = 20, description, url = "", chain = "base", } = args;
        try {
            const session = await getSession();
            if (!session?.authenticated || !session.address) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ No wallet configured.\n\nRun \`wallet_setup\` to create one — it takes 5 seconds, no seed phrase needed.`,
                        }],
                };
            }
            const factoryAddress = FACTORY_ADDRESSES[chain];
            if (!factoryAddress) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ App tokens not yet deployed on ${chain}. Coming soon!`,
                        }],
                };
            }
            // Encode factory call
            const iface = new ethers.Interface(FACTORY_ABI);
            const maxSupply = ethers.parseEther("1000000"); // 1M tokens
            const targetRaise = ethers.parseEther(targetRaiseEth);
            const creatorShareBps = creatorSharePercent * 100;
            const data = iface.encodeFunctionData("createTokenSimple", [
                name,
                symbol,
                maxSupply,
                targetRaise,
                creatorShareBps,
                description,
                url,
            ]);
            // Send transaction
            const result = await sendTransaction(factoryAddress, "0", chain, undefined, data);
            // Parse event to get token address
            // TODO: Decode logs to get actual token address
            const lines = [
                `🎉 App Token Created!`,
                ``,
                `**${name} (${symbol})**`,
                ``,
                `📊 Bonding Curve:`,
                `   Target raise: ${targetRaiseEth} ETH`,
                `   Total supply: 1,000,000 ${symbol}`,
                `   Early price: ~${(parseFloat(targetRaiseEth) / 1000000 * 0.5).toFixed(8)} ETH`,
                `   Final price: ~${(parseFloat(targetRaiseEth) / 1000000 * 2).toFixed(8)} ETH`,
                ``,
                `💰 Revenue Split:`,
                `   You (creator): ${creatorSharePercent}%`,
                `   Token holders: ${78 - creatorSharePercent}%`,
                `   Platform: 2%`,
                ``,
                `📝 Transaction: ${result.txHash}`,
                ``,
                `Next steps:`,
                `1. Share your token with investors`,
                `2. They buy via: wallet_buy_app_token <address> <eth_amount>`,
                `3. When you earn revenue: wallet_distribute_revenue <address> <eth>`,
            ];
            return {
                content: [{
                        type: "text",
                        text: lines.join("\n"),
                    }],
            };
        }
        catch (error) {
            console.error("wallet_create_app_token error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                    }],
            };
        }
    });
    // ═══════════════════════════════════════════════════════════════════════
    // wallet_buy_app_token
    // ═══════════════════════════════════════════════════════════════════════
    server.registerTool("wallet_buy_app_token", {
        description: `Buy tokens on an app's bonding curve.

**How it works:**
- Earlier buyers get lower prices
- Your tokens earn dividends from app revenue
- You can sell back anytime (before graduation)

**Example:**
"Buy 0.1 ETH worth of $SWAP tokens"`,
        inputSchema: {
            tokenAddress: z.string().describe("App token contract address"),
            ethAmount: z.string().describe("ETH to spend (e.g., '0.1')"),
            slippagePercent: z.number().optional().default(1).describe("Max slippage (default 1%)"),
            chain: z.enum(SUPPORTED_CHAINS).default("base"),
        },
    }, async (args) => {
        const { tokenAddress, ethAmount, slippagePercent = 1, chain = "base" } = args;
        try {
            const session = await getSession();
            if (!session?.authenticated || !session.address) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ No wallet configured.\n\nRun \`wallet_setup\` to create one — it takes 5 seconds, no seed phrase needed.`,
                        }],
                };
            }
            const provider = getProvider(chain);
            const token = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
            // Get quote
            const ethWei = ethers.parseEther(ethAmount);
            const [tokensOut, ethCost, fee] = await token.quoteBuy(ethWei);
            // Calculate minimum with slippage
            const minTokens = tokensOut * BigInt(100 - slippagePercent) / 100n;
            // Get token info
            const [name, symbol, price] = await Promise.all([
                token.name(),
                token.symbol(),
                token.currentPrice(),
            ]);
            // Encode buy call
            const iface = new ethers.Interface(TOKEN_ABI);
            const data = iface.encodeFunctionData("buy", [minTokens]);
            // Execute
            const result = await sendTransaction(tokenAddress, ethAmount, chain, undefined, data);
            const tokensFormatted = ethers.formatEther(tokensOut);
            const feeFormatted = ethers.formatEther(fee);
            return {
                content: [{
                        type: "text",
                        text: [
                            `✅ Purchased ${name} (${symbol})`,
                            ``,
                            `You received: ${parseFloat(tokensFormatted).toLocaleString()} ${symbol}`,
                            `You paid: ${ethAmount} ETH`,
                            `Trading fee: ${feeFormatted} ETH`,
                            ``,
                            `Current price: ${ethers.formatEther(price)} ETH per token`,
                            ``,
                            `Transaction: ${result.txHash}`,
                            ``,
                            `💡 Your tokens will be eligible for dividends in 1 hour.`,
                        ].join("\n"),
                    }],
            };
        }
        catch (error) {
            console.error("wallet_buy_app_token error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                    }],
            };
        }
    });
    // ═══════════════════════════════════════════════════════════════════════
    // wallet_sell_app_token
    // ═══════════════════════════════════════════════════════════════════════
    server.registerTool("wallet_sell_app_token", {
        description: `Sell app tokens back to the bonding curve.

**Note:** Only works before graduation. After graduation, trade on DEX.`,
        inputSchema: {
            tokenAddress: z.string().describe("App token contract address"),
            tokenAmount: z.string().describe("Tokens to sell (e.g., '1000' or 'all')"),
            slippagePercent: z.number().optional().default(1).describe("Max slippage (default 1%)"),
            chain: z.enum(SUPPORTED_CHAINS).default("base"),
        },
    }, async (args) => {
        const { tokenAddress, tokenAmount, slippagePercent = 1, chain = "base" } = args;
        try {
            const session = await getSession();
            if (!session?.authenticated || !session.address) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ No wallet configured.\n\nRun \`wallet_setup\` to create one — it takes 5 seconds, no seed phrase needed.`,
                        }],
                };
            }
            const provider = getProvider(chain);
            const token = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
            // Get balance if selling all
            let sellAmount;
            if (tokenAmount.toLowerCase() === "all") {
                sellAmount = await token.balanceOf(session.address);
            }
            else {
                sellAmount = ethers.parseEther(tokenAmount);
            }
            // Get quote
            const [ethOut, fee, toSeller] = await token.quoteSell(sellAmount);
            // Calculate minimum with slippage
            const minEth = toSeller * BigInt(100 - slippagePercent) / 100n;
            // Get token info
            const [name, symbol] = await Promise.all([
                token.name(),
                token.symbol(),
            ]);
            // Encode sell call
            const iface = new ethers.Interface(TOKEN_ABI);
            const data = iface.encodeFunctionData("sell", [sellAmount, minEth]);
            // Execute
            const result = await sendTransaction(tokenAddress, "0", chain, undefined, data);
            return {
                content: [{
                        type: "text",
                        text: [
                            `✅ Sold ${name} (${symbol})`,
                            ``,
                            `You sold: ${ethers.formatEther(sellAmount)} ${symbol}`,
                            `You received: ${ethers.formatEther(toSeller)} ETH`,
                            `Trading fee: ${ethers.formatEther(fee)} ETH`,
                            ``,
                            `Transaction: ${result.txHash}`,
                        ].join("\n"),
                    }],
            };
        }
        catch (error) {
            console.error("wallet_sell_app_token error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                    }],
            };
        }
    });
    // ═══════════════════════════════════════════════════════════════════════
    // wallet_claim_dividends
    // ═══════════════════════════════════════════════════════════════════════
    server.registerTool("wallet_claim_dividends", {
        description: `Claim your dividend earnings from an app token.

Your share is based on how many tokens you hold and how long you've held them.`,
        inputSchema: {
            tokenAddress: z.string().describe("App token contract address"),
            chain: z.enum(SUPPORTED_CHAINS).default("base"),
        },
    }, async (args) => {
        const { tokenAddress, chain = "base" } = args;
        try {
            const session = await getSession();
            if (!session?.authenticated || !session.address) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ No wallet configured.\n\nRun \`wallet_setup\` to create one — it takes 5 seconds, no seed phrase needed.`,
                        }],
                };
            }
            const provider = getProvider(chain);
            const token = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
            // Check claimable amount
            const [withdrawable, withdrawn] = await token.dividendInfo(session.address);
            if (withdrawable === 0n) {
                return {
                    content: [{
                            type: "text",
                            text: [
                                `No dividends to claim right now.`,
                                ``,
                                `Previously claimed: ${ethers.formatEther(withdrawn)} ETH`,
                                ``,
                                `💡 Dividends accumulate as the app earns revenue.`,
                            ].join("\n"),
                        }],
                };
            }
            // Get token info
            const [name, symbol] = await Promise.all([
                token.name(),
                token.symbol(),
            ]);
            // Encode withdraw call
            const iface = new ethers.Interface(TOKEN_ABI);
            const data = iface.encodeFunctionData("withdrawDividend", []);
            // Execute
            const result = await sendTransaction(tokenAddress, "0", chain, undefined, data);
            return {
                content: [{
                        type: "text",
                        text: [
                            `✅ Dividends Claimed!`,
                            ``,
                            `From: ${name} (${symbol})`,
                            `Amount: ${ethers.formatEther(withdrawable)} ETH`,
                            ``,
                            `Total claimed to date: ${ethers.formatEther(withdrawn + withdrawable)} ETH`,
                            ``,
                            `Transaction: ${result.txHash}`,
                        ].join("\n"),
                    }],
            };
        }
        catch (error) {
            console.error("wallet_claim_dividends error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                    }],
            };
        }
    });
    // ═══════════════════════════════════════════════════════════════════════
    // wallet_app_token_info
    // ═══════════════════════════════════════════════════════════════════════
    server.registerTool("wallet_app_token_info", {
        description: `View detailed info about an app token, including your position and earnings.`,
        inputSchema: {
            tokenAddress: z.string().describe("App token contract address"),
            chain: z.enum(SUPPORTED_CHAINS).default("base"),
        },
    }, async (args) => {
        const { tokenAddress, chain = "base" } = args;
        try {
            const session = await getSession();
            const provider = getProvider(chain);
            const token = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
            // Fetch all info in parallel
            const [name, symbol, totalSupply, maxSupply, currentPrice, reserveEth, dividendEth, totalDividends, creator, stateNum, description, url, progress,] = await Promise.all([
                token.name(),
                token.symbol(),
                token.totalSupply(),
                token.maxSupply(),
                token.currentPrice(),
                token.reserveEth(),
                token.dividendEth(),
                token.totalDividendsDistributed(),
                token.creator(),
                token.state(),
                token.appDescription(),
                token.appUrl(),
                token.progress(),
            ]);
            const stateLabels = ["Trading", "Frozen", "Graduated"];
            const stateLabel = stateLabels[Number(stateNum)] || "Unknown";
            const lines = [
                `📊 ${name} (${symbol})`,
                ``,
                `${description}`,
                url ? `🔗 ${url}` : "",
                ``,
                `═══ Bonding Curve ═══`,
                `Status: ${stateLabel}`,
                `Progress: ${progress[0]}% sold`,
                `Tokens sold: ${ethers.formatEther(progress[1])} / ${ethers.formatEther(maxSupply)}`,
                `ETH raised: ${ethers.formatEther(progress[3])} ETH`,
                `Current price: ${ethers.formatEther(currentPrice)} ETH`,
                ``,
                `═══ Financials ═══`,
                `Reserve (backs sells): ${ethers.formatEther(reserveEth)} ETH`,
                `Dividend pool: ${ethers.formatEther(dividendEth)} ETH`,
                `Total dividends paid: ${ethers.formatEther(totalDividends)} ETH`,
                ``,
                `Creator: ${creator.slice(0, 8)}...${creator.slice(-6)}`,
            ];
            // Add user position if authenticated
            if (session?.authenticated && session.address) {
                const [balance, dividendInfo] = await Promise.all([
                    token.balanceOf(session.address),
                    token.dividendInfo(session.address),
                ]);
                const ownership = totalSupply > 0n
                    ? (Number(balance) / Number(totalSupply) * 100).toFixed(2)
                    : "0";
                lines.push(``, `═══ Your Position ═══`, `Balance: ${ethers.formatEther(balance)} ${symbol} (${ownership}%)`, `Claimable dividends: ${ethers.formatEther(dividendInfo[0])} ETH`, `Previously claimed: ${ethers.formatEther(dividendInfo[1])} ETH`);
                // Check if eligible for dividends
                const now = Math.floor(Date.now() / 1000);
                if (dividendInfo[3] > now) {
                    const waitMinutes = Math.ceil((Number(dividendInfo[3]) - now) / 60);
                    lines.push(`⏳ Eligible for new dividends in ~${waitMinutes} min`);
                }
            }
            return {
                content: [{
                        type: "text",
                        text: lines.filter(l => l !== "").join("\n"),
                    }],
            };
        }
        catch (error) {
            console.error("wallet_app_token_info error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                    }],
            };
        }
    });
    // ═══════════════════════════════════════════════════════════════════════
    // wallet_distribute_revenue (for creators)
    // ═══════════════════════════════════════════════════════════════════════
    server.registerTool("wallet_distribute_revenue", {
        description: `(For app creators) Distribute revenue to your token holders.

Call this whenever your app earns money to share it with investors.`,
        inputSchema: {
            tokenAddress: z.string().describe("Your app token contract address"),
            ethAmount: z.string().describe("ETH to distribute"),
            chain: z.enum(SUPPORTED_CHAINS).default("base"),
        },
    }, async (args) => {
        const { tokenAddress, ethAmount, chain = "base" } = args;
        try {
            const session = await getSession();
            if (!session?.authenticated || !session.address) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ No wallet configured.\n\nRun \`wallet_setup\` to create one — it takes 5 seconds, no seed phrase needed.`,
                        }],
                };
            }
            const provider = getProvider(chain);
            const token = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
            // Get token info
            const [name, symbol, totalSupply] = await Promise.all([
                token.name(),
                token.symbol(),
                token.totalSupply(),
            ]);
            // Encode distribute call
            const iface = new ethers.Interface(TOKEN_ABI);
            const data = iface.encodeFunctionData("distributeRevenue", []);
            // Execute
            const result = await sendTransaction(tokenAddress, ethAmount, chain, undefined, data);
            const ethNum = parseFloat(ethAmount);
            const creatorShare = ethNum * 0.2; // Assuming 20% creator share
            const platformShare = ethNum * 0.02;
            const holderShare = ethNum - creatorShare - platformShare;
            return {
                content: [{
                        type: "text",
                        text: [
                            `✅ Revenue Distributed!`,
                            ``,
                            `Token: ${name} (${symbol})`,
                            `Total: ${ethAmount} ETH`,
                            ``,
                            `Distribution:`,
                            `  → You (creator): ${creatorShare.toFixed(4)} ETH`,
                            `  → Token holders: ${holderShare.toFixed(4)} ETH`,
                            `  → Platform: ${platformShare.toFixed(4)} ETH`,
                            ``,
                            `Holders can claim via: wallet_claim_dividends`,
                            ``,
                            `Transaction: ${result.txHash}`,
                        ].join("\n"),
                    }],
            };
        }
        catch (error) {
            console.error("wallet_distribute_revenue error:", error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                    }],
            };
        }
    });
}
//# sourceMappingURL=app-token.js.map
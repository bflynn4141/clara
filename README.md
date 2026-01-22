# Clara

**Keys should be as universal as code.**

A wallet for Claude Code, powered by [Para](https://getpara.com).

🌐 **[tryclara.vercel.app](https://tryclara.vercel.app)**

<video src="https://github.com/bflynn4141/para-wallet/raw/main/assets/clara-demo.mp4" width="100%" autoplay loop muted playsinline></video>

---

## The Vision

The interface is changing. Users are moving from app-specific frontends to their own AI-powered clients. You don't go to a website—your assistant goes for you.

This breaks wallets. Browser extensions assume a browser. Hardware wallets assume a specific device. Keys are trapped in contexts that are disappearing.

**Clara is the first wallet built for this shift.** Not a browser extension. Not an app. A capability that lives where the user already is.

---

## Use Cases

**Everyday Transactions**
```
"Send 0.1 ETH to vitalik.eth"
"What's my balance on Base?"
"Transfer 50 USDC to 0x..."
```

**DeFi Operations**
```
"Deposit 1 ETH into Aave for yield"
"Swap 100 USDC for ETH on Uniswap"
"Check my staking rewards"
```

**Developer Workflows**
```
"Deploy this contract to Base"
"Sign this message to verify my identity"
"Approve the token spend for this dApp"
```

**Cross-Chain Identity**
```
"What's my address?" → Same wallet works on Ethereum, Base, Arbitrum, Optimism, Polygon, and Solana
```

**ENS Support**
```
"Send 0.1 ETH to vitalik.eth"     → Resolves ENS name automatically
"Who is vitalik.eth?"             → Shows the address
"What's the ENS for 0xd8dA6B..."  → Reverse lookup
```

**Portfolio View**
```
"What do I own?"                  → Shows all balances + USD values
"Show my portfolio"               → Multi-chain overview with 24h changes
```

---

## Quick Start

### 1. Install

Add to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "clara-wallet": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "clara-wallet"]
    }
  }
}
```

Or install from GitHub:

```json
{
  "mcpServers": {
    "clara-wallet": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:bflynn4141/clara"]
    }
  }
}
```

### 2. Verify Installation (Optional)

```bash
npx clara-wallet
# Should output: "Para Wallet MCP Server running on stdio"
# Press Ctrl+C to exit
```

### 3. Restart Claude Code

Close and reopen Claude Code to load the wallet.

### 3. Setup Your Wallet

```
You: setup my wallet with me@example.com
Claude: Check your email for a verification code!
You: 123456
Claude: ✓ Wallet ready! Your address is 0x...
```

That's it. No API keys. No seed phrases. No browser extensions.

---

## Features

| Feature | Description |
|---------|-------------|
| **Email-based setup** | Verify with OTP, no seed phrases |
| **MPC Security** | Keys split across infrastructure, never in one place |
| **Multi-chain** | Ethereum, Base, Arbitrum, Optimism, Polygon, Solana |
| **Persistent** | Wallet survives across sessions |
| **Portable** | Access the same wallet at [getpara.com](https://getpara.com) |
| **Context-aware** | Claude understands what it's signing |

---

## How It Works

### MPC (Multi-Party Computation)

Your keys are never stored in one place:

1. **Key Generation** — Cryptographic keys generated across multiple parties
2. **Your Share** — Stored encrypted locally on your machine
3. **Para's Share** — Held on Para's infrastructure
4. **Signing** — Both shares collaborate (neither can sign alone)

This means: no single point of failure, no exposed private keys, you maintain custody.

### Why This Matters

Traditional wallets force a choice: convenience (hot wallets) or security (hardware wallets). MPC eliminates this tradeoff—keys that are both accessible and secure.

---

## Supported Chains

| Chain | Type | Native Token |
|-------|------|--------------|
| Ethereum | EVM | ETH |
| Base | EVM | ETH |
| Arbitrum | EVM | ETH |
| Optimism | EVM | ETH |
| Polygon | EVM | MATIC |
| Solana | Ed25519 | SOL |

One wallet setup creates both an EVM address (works across all EVM chains) and a Solana address.

---

## Available Tools

| Tool | Description |
|------|-------------|
| `wallet_setup` | Initialize wallet with email OTP |
| `wallet_status` | Check authentication state |
| `wallet_get_address` | Get address for any chain |
| `wallet_get_balance` | Check token balances |
| `wallet_sign_message` | Sign messages (SIWE, etc.) |
| `wallet_sign_transaction` | Sign transactions |
| `wallet_send` | Send tokens (supports ENS names) |
| `wallet_resolve_ens` | Resolve ENS names ↔ addresses |
| `wallet_portfolio` | View portfolio with USD values |
| `wallet_logout` | Clear local session |

---

## Security

**Local Storage**
- Session encrypted with AES-256-GCM at `~/.claude/para-wallet/`
- Session expires after 24 hours of inactivity

**Transaction Safety**
- All signing requires explicit approval
- Full transaction details shown before signing
- Amount, recipient, and gas estimates displayed

---

## Current Limitations

- **ERC-20 transfers** — Balance checks supported, transfers coming soon
- **SPL tokens** — Not yet supported
- **Complex DeFi** — Basic patterns supported, advanced interactions in development

---

## Credits

- [Para](https://getpara.com) — MPC wallet infrastructure
- [Claude Code](https://claude.ai/code) — AI coding assistant
- [MCP](https://modelcontextprotocol.io/) — Model Context Protocol

---

## License

MIT

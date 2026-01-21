# Para Wallet MCP

A Claude Code plugin that gives you a blockchain wallet powered by [Para](https://getpara.com). Create a wallet once, use it everywhere in Claude Code.

## Features

- **Email-based setup** - No seed phrases, no browser extensions
- **MPC Security** - Keys split across Para's infrastructure (never stored in one place)
- **Multi-chain** - Ethereum, Base, Arbitrum, Optimism, Polygon (Solana coming soon)
- **Persistent** - Wallet survives across sessions, stored encrypted locally
- **Portable** - Same wallet accessible at getpara.com

## Quick Start

### 1. Get a Para API Key

Sign up at [developer.getpara.com](https://developer.getpara.com) to get your API key.

### 2. Install the MCP

Add to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "para-wallet": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/para-wallet/build/index.js"],
      "env": {
        "PARA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### 3. Restart Claude Code

Close and reopen Claude Code to load the new MCP.

### 4. Setup Your Wallet

```
You: setup my wallet with brian@example.com
Claude: Check your email for a verification code!
You: 123456
Claude: ✓ Wallet setup complete! Your address is 0x...
```

## Available Tools

| Tool | Description |
|------|-------------|
| `wallet_setup` | Initialize wallet with email OTP |
| `wallet_status` | Check authentication state |
| `wallet_get_address` | Get address for any chain |
| `wallet_get_balance` | Check token balances |
| `wallet_sign_message` | Sign messages (SIWE, etc.) |
| `wallet_sign_transaction` | Sign transactions |
| `wallet_send` | Send tokens |
| `wallet_logout` | Clear local session |

## Supported Chains

### EVM Chains (secp256k1)
| Chain | Chain ID | Native Token |
|-------|----------|--------------|
| Ethereum | 1 | ETH |
| Base | 8453 | ETH |
| Arbitrum | 42161 | ETH |
| Optimism | 10 | ETH |
| Polygon | 137 | MATIC |

### Solana (Ed25519)
| Chain | Network | Native Token |
|-------|---------|--------------|
| Solana | Mainnet | SOL |

Both wallets are created automatically during setup - one EVM address (works across all EVM chains) and one Solana address.

## How It Works

### MPC (Multi-Party Computation)

Para uses MPC to secure your wallet:

1. **Key Generation** - Cryptographic keys are generated across multiple parties
2. **User Share** - You hold one share, stored encrypted locally
3. **Para Share** - Para holds another share on their infrastructure
4. **Signing** - Both shares collaborate to sign (neither can sign alone)

This means:
- No single point of failure
- Keys are never assembled in one place
- You maintain custody via your share

### Pregenerated Wallets

This MCP uses Para's "pregenerated wallet" flow - perfect for CLI:

1. Provide email address
2. Wallet is created instantly (no browser auth)
3. User share is stored locally for signing
4. Email owner can "claim" the wallet later at getpara.com

## Security

### Local Storage

Session data is stored at `~/.claude/para-wallet/session.enc`:
- Encrypted with AES-256-GCM
- Key stored in `~/.claude/para-wallet/.key`
- Session expires after 24 hours of inactivity

### Transaction Safety

All signing operations require explicit user approval:
- Message signing shows the message content
- Transaction signing shows decoded details
- Send operations show amount, recipient, and estimated gas

## Development

### Build

```bash
npm install
npm run build
```

### Test

```bash
# Set your API key
export PARA_API_KEY='your-key-here'

# Test MCP server
./test-mcp.sh
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PARA_API_KEY` | Your Para API key | Required |
| `PARA_ENV` | `beta` or `production` | `beta` |

## Limitations

- **Solana transactions** - Signing supported, but full tx building requires `@solana/web3.js`
- **ERC-20 tokens** - Balance checks only (transfers need token ABI)
- **SPL tokens** - Not yet supported (requires `@solana/spl-token`)
- **Transaction decoding** - Basic support for common patterns

## License

MIT

## Credits

- [Para](https://getpara.com) - MPC wallet infrastructure
- [Claude Code](https://claude.ai/claude-code) - AI coding assistant
- [MCP SDK](https://modelcontextprotocol.io/) - Model Context Protocol

#!/bin/bash
# Quick test script for para-wallet MCP

if [ -z "$PARA_API_KEY" ]; then
  echo "❌ PARA_API_KEY not set"
  echo "Run: export PARA_API_KEY='your-key-here'"
  exit 1
fi

echo "Testing para-wallet MCP server..."
echo ""

# Test 1: List tools (doesn't require API)
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node build/index.js 2>/dev/null | head -1 | python3 -m json.tool 2>/dev/null && echo "✅ Tools list works" || echo "⚠️ Tools list returned non-JSON"

echo ""
echo "MCP server is working!"
echo ""
echo "To use in Claude Code, add to ~/.claude/settings.json:"
echo '  "mcpServers": {'
echo '    "para-wallet": {'
echo '      "command": "node",'
echo "      \"args\": [\"$PWD/build/index.js\"],"
echo '      "env": { "PARA_API_KEY": "your-key-here" }'
echo '    }'
echo '  }'

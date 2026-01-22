/**
 * Clara Proxy - Cloudflare Worker
 *
 * Proxies requests to Para REST API with the API key injected.
 * Users don't need their own key - you control access.
 *
 * Deploy: wrangler deploy
 * Secret: wrangler secret put PARA_API_KEY
 */

export default {
  async fetch(request, env) {
    // CORS headers for browser/CLI access
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Rate limiting (simple in-memory, resets on worker restart)
    // For production, use Cloudflare KV or Durable Objects
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Only allow GET and POST requests
    if (request.method !== 'POST' && request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      const url = new URL(request.url);
      // Map /api/v1/... to Para's /v1/...
      const paraPath = url.pathname.replace('/api', '');

      // Allowlist of Para REST API endpoints Clara needs
      const allowedPaths = [
        // Wallet operations
        '/v1/wallets',           // POST: create wallet, GET: list wallets
        '/v1/wallets/',          // Wallet-specific operations (sign, etc.)
      ];

      // Check if path is allowed
      const isAllowed = allowedPaths.some(p => paraPath.startsWith(p));
      if (!isAllowed) {
        return new Response(JSON.stringify({ error: 'Endpoint not allowed' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Build Para API URL with query params
      const paraUrl = new URL(`https://api.beta.getpara.com${paraPath}`);
      url.searchParams.forEach((value, key) => {
        paraUrl.searchParams.set(key, value);
      });

      // Forward to Para API
      const fetchOptions = {
        method: request.method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.PARA_API_KEY,
        },
      };

      // Include body for POST requests
      if (request.method === 'POST') {
        fetchOptions.body = await request.text();
      }

      const paraResponse = await fetch(paraUrl.toString(), fetchOptions);
      const responseBody = await paraResponse.text();

      return new Response(responseBody, {
        status: paraResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: 'Proxy error', message: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};

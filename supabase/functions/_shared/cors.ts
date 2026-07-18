// Shared CORS headers for browser-invoked edge functions (create-checkout).
// The webhook is server-to-server and does not need these.

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** JSON response helper that always attaches CORS headers. */
export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      ...extraHeaders,
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
    },
  })
}

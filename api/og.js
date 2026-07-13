// Vercel serverless function: OpenGraph unfurl for room deep links (issue #85).
//
// When someone pastes a room link (`/room/<id>`) into Discord (or any chat that
// unfurls links), the crawler fetches the URL and reads the `<meta>` tags in the
// document `<head>` to build the preview card. A plain SPA serves the same empty
// shell for every route, so every room would unfurl with the generic site title.
//
// `vercel.json` rewrites `/room/:id` to this function. It fetches the real,
// already-built `index.html` (so humans still get the working app with its hashed
// asset bundle and client-side routing) and injects room-specific OpenGraph /
// Twitter tags into the `<head>`. Crawlers read the tags; humans get the app.
//
// Pure infrastructure — no secrets, no env required. The room id is echoed into
// the card; richer per-room detail (name/theme/player count) would need a
// cross-instance room-detail lookup and is a deliberate follow-up.

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPE[ch]);
}

// Room ids are nanoid (URL-safe alphabet). Clamp defensively so a hostile id can
// never smuggle markup into the page even before HTML-escaping.
function sanitizeRoomId(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

function buildMetaTags({ roomId, roomUrl }) {
  const title = 'Join a Dicesuki dice room';
  const description = roomId
    ? `Room ${roomId} is live on Dicesuki. Tap to roll together — no install, right in your browser.`
    : 'Roll physics-based 3D dice together on Dicesuki — no install, right in your browser.';

  const tags = [
    ['og:type', 'website'],
    ['og:site_name', 'Dicesuki'],
    ['og:title', title],
    ['og:description', description],
    ['og:url', roomUrl],
    ['twitter:card', 'summary'],
    ['twitter:title', title],
    ['twitter:description', description],
  ];

  const metaHtml = tags
    .map(([key, value]) => {
      const attr = key.startsWith('twitter:') ? 'name' : 'property';
      return `<meta ${attr}="${escapeHtml(key)}" content="${escapeHtml(value)}" />`;
    })
    .join('\n    ');

  // A distinct <title> improves the fallback (non-OG) unfurl and the browser tab.
  return `<title>${escapeHtml(title)}</title>\n    ${metaHtml}`;
}

// Fetch the deployed app shell so humans get the real bundle. `/index.html` is a
// static file, served directly (not re-routed through this function), so there is
// no loop.
async function fetchAppShell(origin) {
  try {
    const res = await fetch(`${origin}/index.html`, {
      headers: { 'user-agent': 'dicesuki-og-injector' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function injectHead(html, headExtras) {
  if (html.includes('</head>')) {
    return html.replace('</head>', `    ${headExtras}\n  </head>`);
  }
  // No <head> (unexpected) — prepend so crawlers still find the tags.
  return `${headExtras}\n${html}`;
}

export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'dicesuki.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const origin = `${proto}://${host}`;

  const url = new URL(req.url, origin);
  const roomId = sanitizeRoomId(url.searchParams.get('id') || '');
  const roomUrl = roomId ? `${origin}/room/${roomId}` : origin;

  const headExtras = buildMetaTags({ roomId, roomUrl });

  let html = await fetchAppShell(origin);
  if (html) {
    html = injectHead(html, headExtras);
  } else {
    // Degraded fallback: a minimal document that still unfurls, and sends humans
    // on to the app root if the shell could not be fetched.
    html = `<!doctype html><html lang="en"><head><meta charset="UTF-8" />\n    ${headExtras}\n    <meta http-equiv="refresh" content="0; url=${escapeHtml(roomUrl)}" /></head><body></body></html>`;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Let Discord's crawler and the CDN cache the unfurl briefly; room state that
  // affects the card is coarse, so a short TTL is plenty.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.status(200).send(html);
}

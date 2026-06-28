const ALLOWED = ['https://kataly.cc', 'http://localhost', 'http://127.0.0.1'];

function cors(origin) {
  const allowed = ALLOWED.find(o => origin && origin.startsWith(o)) ?? 'https://kataly.cc';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
  };
}

async function checkTelegram(username) {
  const res = await fetch(`https://t.me/${encodeURIComponent(username)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    redirect: 'follow',
  });
  const html = await res.text();
  // t.me pages for existing users/channels have tgme_page_title; non-existent usernames don't
  const taken = html.includes('tgme_page_title') || html.includes('tgme_page_photo');
  return taken ? 'taken' : 'available';
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') ?? '';
    const headers = cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers });

    const url = new URL(request.url);
    const p = url.searchParams.get('p');
    const u = url.searchParams.get('u');

    if (!u || !/^[a-zA-Z0-9_]{1,32}$/.test(u)) {
      return Response.json({ error: 'invalid' }, { status: 400, headers });
    }

    try {
      if (p === 'tg') {
        const status = await checkTelegram(u);
        return Response.json({ status }, { headers });
      }
      return Response.json({ error: 'unsupported platform' }, { status: 400, headers });
    } catch {
      return Response.json({ status: 'error' }, { headers });
    }
  },
};

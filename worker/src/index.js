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

async function checkInstagram(username) {
  // Don't follow redirects: non-existent profiles return 404, existing ones redirect (302) to login
  const res = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'manual',
  });
  if (res.status === 404) return 'available';
  if (res.status === 301 || res.status === 302 || res.status === 200) return 'taken';
  if (res.status === 429) return 'ratelimit';
  return 'error';
}

async function checkTelegram(username) {
  const res = await fetch(`https://t.me/${encodeURIComponent(username)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    redirect: 'follow',
  });
  const html = await res.text();
  const taken = html.includes('tgme_page_title') || html.includes('tgme_page_photo');
  return taken ? 'taken' : 'available';
}

async function checkDiscordAvailable(username) {
  const endpoints = [
    'https://discord.com/api/v10/unique-username/username-attempt-unauthed',
    'https://discord.com/api/v10/users/pomelo-attempt',
  ];
  for (const url of endpoints) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Origin': 'https://discord.com',
        'Referer': 'https://discord.com/',
      },
      body: JSON.stringify({ username }),
    });
    if (res.status === 200) {
      const data = await res.json().catch(() => ({}));
      if ('taken' in data) return data.taken ? 'taken' : 'available';
    }
    if (res.status === 429) return 'ratelimit';
  }
  return 'no_unauthed';
}

async function claimDiscord(username, token) {
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    method: 'PATCH',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username }),
  });

  if (res.status === 200) return 'claimed';

  if (res.status === 400) {
    const data = await res.json().catch(() => ({}));
    const errs = data?.errors?.username?._errors ?? [];
    if (errs.some(e => e.code === 'USERNAME_ALREADY_TAKEN')) return 'taken';
    return 'error';
  }

  if (res.status === 401) return 'invalid_token';
  if (res.status === 429) return 'ratelimit';
  return 'error';
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
      if (p === 'ig') {
        const status = await checkInstagram(u);
        return Response.json({ status }, { headers });
      }

      if (p === 'tg') {
        const status = await checkTelegram(u);
        return Response.json({ status }, { headers });
      }

      if (p === 'dc') {
        const token = request.headers.get('X-Discord-Token');
        if (!token) {
          const status = await checkDiscordAvailable(u);
          return Response.json({ status }, { headers });
        }
        const status = await claimDiscord(u, token);
        return Response.json({ status }, { headers });
      }

      return Response.json({ error: 'unsupported platform' }, { status: 400, headers });
    } catch {
      return Response.json({ status: 'error' }, { headers });
    }
  },
};

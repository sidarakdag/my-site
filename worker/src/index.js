const ALLOWED = ['https://kataly.cc', 'http://localhost', 'http://127.0.0.1'];

function cors(origin) {
  const allowed = ALLOWED.find(o => origin && origin.startsWith(o)) ?? 'https://kataly.cc';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Discord-Token, X-Discord-Original, X-IG-Session',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
  };
}

async function checkInstagram(username, session) {
  const hdrs = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  if (session) hdrs['Cookie'] = `sessionid=${session}`;
  const res = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
    headers: hdrs,
    redirect: 'follow',
  });
  if (res.status === 404) return 'available';
  if (res.status === 429) return 'ratelimit';
  if (res.url && res.url.includes('/accounts/login/')) return session ? 'invalid_session' : 'unverified';
  if (res.status === 403) return 'unverified';
  if (res.status !== 200) return 'error';
  const html = await res.text();
  if (
    html.includes('Page Not Found') ||
    html.includes('"pageNotFound"') ||
    html.includes('Sorry, this page') ||
    html.includes("isn't available") ||
    html.includes("’t available")
  ) return 'available';
  return 'taken';
}

async function checkTelegram(username) {
  if (username.length < 5) return 'too_short';

  const [tmeRes, fragRes] = await Promise.all([
    fetch(`https://t.me/${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      redirect: 'follow',
    }),
    fetch(`https://fragment.com/username/${encodeURIComponent('@' + username)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      redirect: 'follow',
    }).catch(() => null),
  ]);

  const html = await tmeRes.text();
  if (html.includes('tgme_page_title') || html.includes('tgme_page_photo')) return 'taken';
  if (html.includes('fragment.com')) return 'forsale';

  if (fragRes && fragRes.ok) {
    const fragHtml = await fragRes.text().catch(() => '');
    if (
      fragHtml.includes('table-cell-value') ||
      fragHtml.includes('ton-crystal') ||
      fragHtml.includes('js-bid') ||
      fragHtml.includes('"sold"') ||
      fragHtml.includes('"active"') ||
      fragHtml.includes('"ongoing"')
    ) return 'forsale';
  }

  return 'available';
}

async function checkDiscordAvailable(username) {
  const superProps = btoa(JSON.stringify({
    os: 'Windows', browser: 'Chrome', device: '',
    system_locale: 'en-US',
    browser_user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    browser_version: '120.0.0.0', os_version: '10',
    release_channel: 'stable', client_build_number: 270580,
    client_event_source: null,
  }));

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
        'X-Super-Properties': superProps,
        'X-Discord-Locale': 'en-US',
        'Accept': '*/*',
        'Origin': 'https://discord.com',
        'Referer': 'https://discord.com/register',
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

async function checkDiscordScan(username, token, original) {
  if (!original || original === username) {
    const me = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { 'Authorization': token },
    });
    if (me.status === 401) return 'invalid_token';
    if (me.status === 429) return 'ratelimit';
    if (me.status !== 200) return 'error';
    const data = await me.json();
    original = data.username;
    if (original === username) return 'taken';
  }

  const patch = await fetch('https://discord.com/api/v10/users/@me', {
    method: 'PATCH',
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });

  if (patch.status === 400) {
    const data = await patch.json().catch(() => ({}));
    const errs = data?.errors?.username?._errors ?? [];
    if (errs.some(e => e.code === 'USERNAME_ALREADY_TAKEN')) return 'taken';
    return 'error';
  }
  if (patch.status === 401) return 'invalid_token';
  if (patch.status === 429) return 'ratelimit';
  if (patch.status !== 200) return 'error';

  const revert = await fetch('https://discord.com/api/v10/users/@me', {
    method: 'PATCH',
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: original }),
  });
  if (revert.status === 429) return 'changed';
  return 'available';
}

async function claimDiscord(username, token) {
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    method: 'PATCH',
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
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

    // Batch endpoint (POST /check?p=ig|tg)
    if (request.method === 'POST' && (p === 'ig' || p === 'tg')) {
      try {
        const body = await request.json();
        if (!Array.isArray(body) || body.length > 100 ||
            !body.every(u => /^[a-zA-Z0-9_]{1,32}$/.test(u))) {
          return Response.json({ error: 'invalid' }, { status: 400, headers });
        }
        const igSession = request.headers.get('X-IG-Session') || '';
        const checkFn = p === 'ig' ? (u => checkInstagram(u, igSession)) : checkTelegram;
        const results = await Promise.all(
          body.map(async u => { try { return { u, s: await checkFn(u) }; } catch { return { u, s: 'error' }; } })
        );
        return Response.json(results, { headers });
      } catch {
        return Response.json({ error: 'error' }, { status: 500, headers });
      }
    }

    // Single-username endpoint (GET)
    const u = url.searchParams.get('u');
    if (!u || !/^[a-zA-Z0-9_]{1,32}$/.test(u)) {
      return Response.json({ error: 'invalid' }, { status: 400, headers });
    }

    try {
      if (p === 'ig') {
        const igSession = request.headers.get('X-IG-Session') || '';
        const status = await checkInstagram(u, igSession);
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
        const mode = url.searchParams.get('mode');
        if (mode === 'scan') {
          const original = request.headers.get('X-Discord-Original') || '';
          const status = await checkDiscordScan(u, token, original);
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

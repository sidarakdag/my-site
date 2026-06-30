const ALLOWED = ['https://kataly.cc', 'http://localhost', 'http://127.0.0.1'];

function cors(origin) {
  const allowed = ALLOWED.find(o => origin && origin.startsWith(o)) ?? 'https://kataly.cc';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Discord-Token, X-Discord-Original, X-IG-Session, X-TG-Bot-Token',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
  };
}

async function checkInstagram(username, session) {
  // Primary: JSON API endpoint (accurate, session optional)
  const apiHdrs = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'X-IG-App-ID': '936619743392459',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.instagram.com/',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (session) apiHdrs['Cookie'] = `sessionid=${session}`;

  try {
    const apiRes = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      { headers: apiHdrs, redirect: 'follow' }
    );
    if (apiRes.status === 404) return 'available';
    if (apiRes.status === 429) return 'ratelimit';
    if (apiRes.status === 401 || apiRes.status === 403) {
      if (session) return 'invalid_session';
      // No session: fall through to HTML scrape below
    } else if (apiRes.status === 200) {
      const data = await apiRes.json().catch(() => null);
      if (!data) { /* fall through */ }
      else if (data.status === 'fail' || data.message === 'login_required') {
        if (session) return 'invalid_session';
        // No session: fall through to HTML scrape
      } else if (data?.data?.user === null) return 'available';
      else if (data?.data?.user) return 'taken';
    }
  } catch {}

  // Fallback: HTML scrape (catches session-less checks and API failures)
  const htmlHdrs = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  if (session) htmlHdrs['Cookie'] = `sessionid=${session}`;
  try {
    const res = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
      headers: htmlHdrs, redirect: 'follow',
    });
    if (res.status === 404) return 'available';
    if (res.status === 429) return 'ratelimit';
    if (res.url && res.url.includes('/accounts/login/')) return session ? 'invalid_session' : 'unverified';
    if (res.status === 403) return 'unverified';
    if (res.status !== 200) return session ? 'error' : 'unverified';
    const html = await res.text();
    // Instagram SPA: look for not-found signals in embedded JSON/text
    if (
      html.includes('Page Not Found') || html.includes('"pageNotFound"') ||
      html.includes('Sorry, this page') || html.includes("isn't available") ||
      html.includes('"not_found"') || html.includes('page_not_found') ||
      html.includes('"PageNotFound"') || html.includes('"errorPage"')
    ) return 'available';
    // Login wall without a real profile → can't tell
    if (html.includes('Log in') && !html.includes('"id"')) return 'unverified';
    return 'taken';
  } catch {
    return 'error';
  }
}

async function checkTelegram(username) {
  if (username.length < 5) return 'too_short';

  const [tmeRes, fragRes] = await Promise.all([
    fetch(`https://t.me/${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      redirect: 'follow',
    }),
    fetch(`https://fragment.com/username/@${username}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    }).catch(() => null),
  ]);

  const html = await tmeRes.text();
  if (html.includes('tgme_page_title') || html.includes('tgme_page_photo')) return 'taken';
  if (html.includes('fragment.com')) return 'forsale';

  if (fragRes && fragRes.ok) {
    const fragHtml = await fragRes.text().catch(() => '');
    const titleMatch = fragHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch && titleMatch[1].toLowerCase().includes('@' + username.toLowerCase())) {
      return 'forsale';
    }
    const lc = fragHtml.toLowerCase();
    const uLc = username.toLowerCase();
    if (lc.includes(uLc) && (lc.includes('ton') || lc.includes('auction') || lc.includes('js-bid'))) {
      return 'forsale';
    }
  }

  return 'available';
}

async function checkTelegramBot(username, token) {
  if (username.length < 5) return 'too_short';

  const [botRes, fragRes] = await Promise.all([
    fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=%40${username}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }).catch(() => null),
    fetch(`https://fragment.com/username/@${username}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    }).catch(() => null),
  ]);

  if (!botRes) return await checkTelegram(username);
  if (botRes.status === 401) return 'invalid_token';

  if (botRes.ok) {
    const data = await botRes.json().catch(() => ({}));
    if (data.ok) return 'taken';
  }

  if (fragRes && fragRes.ok) {
    const fragHtml = await fragRes.text().catch(() => '');
    const titleMatch = fragHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch && titleMatch[1].toLowerCase().includes('@' + username.toLowerCase())) return 'forsale';
    const lc = fragHtml.toLowerCase();
    if (lc.includes(username.toLowerCase()) && (lc.includes('ton') || lc.includes('auction') || lc.includes('js-bid'))) return 'forsale';
  }

  return 'available';
}

async function checkDiscordAvailable(username) {
  const superProps = btoa(JSON.stringify({
    os: 'Windows', browser: 'Chrome', device: '',
    system_locale: 'en-US',
    browser_user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    browser_version: '131.0.0.0', os_version: '10',
    release_channel: 'stable', client_build_number: 347098,
    client_event_source: null,
  }));

  const endpoints = [
    'https://discord.com/api/v10/unique-username/username-attempt-unauthed',
    'https://discord.com/api/v10/users/pomelo-attempt',
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
        if (typeof data.taken === 'boolean') return data.taken ? 'taken' : 'available';
      }
      if (res.status === 429) return 'ratelimit';
    } catch {}
  }
  // Unauthenticated endpoints deprecated; token required for accurate check
  return 'unverified';
}

async function checkDiscordScan(username, token, original) {
  // Verify token and get current username
  if (!original) {
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

  // Non-destructive check: pomelo-attempt with full Discord client headers
  try {
    const pomelo = await fetch('https://discord.com/api/v10/users/@me/pomelo-attempt', {
      method: 'POST',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Discord-Locale': 'en-US',
        'X-Discord-Timezone': 'America/New_York',
        'Origin': 'https://discord.com',
        'Referer': 'https://discord.com/channels/@me',
      },
      body: JSON.stringify({ username }),
    });
    if (pomelo.status === 200) {
      const d = await pomelo.json().catch(() => ({}));
      if (typeof d.taken === 'boolean') return d.taken ? 'taken' : 'available';
    }
    if (pomelo.status === 429) return 'ratelimit';
    if (pomelo.status === 401) return 'invalid_token';
  } catch {}

  // PATCH probe — works only for accounts without a password (rare).
  // Discord now requires password for username changes so 400 is expected for both
  // taken AND available usernames; we can only distinguish via username-specific errors.
  const patch = await fetch('https://discord.com/api/v10/users/@me', {
    method: 'PATCH',
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });

  if (patch.status === 400) {
    const data = await patch.json().catch(() => ({}));
    const usernameErrs = data?.errors?.username?._errors ?? [];
    const raw = JSON.stringify(data).toLowerCase();
    if (
      usernameErrs.some(e => e.code === 'USERNAME_ALREADY_TAKEN') ||
      usernameErrs.some(e => e.code === 'POMELO_USERNAME_ALREADY_TAKEN') ||
      usernameErrs.some(e => (e.message || '').toLowerCase().includes('already taken')) ||
      raw.includes('username_already_taken')
    ) return 'taken';
    // Password required but no username error — can't distinguish available vs taken
    return 'unverified';
  }
  if (patch.status === 401) return 'invalid_token';
  if (patch.status === 429) return 'ratelimit';
  if (patch.status !== 200) return 'error';

  // Reached only if username change succeeded (no password on this account)
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

// ── Background scanner helpers ──────────────────────────────────────────────

let bgWordCache = null;

function bgRandomCombos(charset, length, count) {
  const sets = {
    letters: 'abcdefghijklmnopqrstuvwxyz',
    nums:    '0123456789',
    mix:     'abcdefghijklmnopqrstuvwxyz0123456789',
  };
  const chars = sets[charset] || sets.letters;
  const result = [], seen = new Set();
  let guard = count * 20;
  while (result.length < count && guard-- > 0) {
    let s = '';
    for (let i = 0; i < length; i++) s += chars[Math.floor(Math.random() * chars.length)];
    if (!seen.has(s)) { seen.add(s); result.push(s); }
  }
  return result;
}

async function bgWordCombos(length, count) {
  if (!bgWordCache) {
    try {
      const r = await fetch('https://kataly.cc/usernamefinder/words.txt', {
        headers: { 'User-Agent': 'KatalyBgScanner/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) {
        const text = await r.text();
        bgWordCache = text.split('\n').map(w => w.trim()).filter(w => /^[a-zA-Z0-9]+$/.test(w) && w.length > 0);
      }
    } catch {}
    if (!bgWordCache) bgWordCache = [];
  }
  const pool = bgWordCache.filter(w => w.length === length);
  if (pool.length === 0) return bgRandomCombos('letters', length, count);
  const take = Math.min(count, pool.length);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take);
}

async function bgCombos(charset, length, count) {
  if (charset === 'words') return bgWordCombos(length, count);
  return bgRandomCombos(charset, length, count);
}

async function bgPostHit(username, platform, webhookUrl) {
  if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) return;
  const COLORS = { ig: 0xE1306C, tg: 0x2AABEE };
  const NAMES  = { ig: 'Instagram', tg: 'Telegram' };
  const PROF   = { ig: u => `https://www.instagram.com/${u}/`, tg: u => `https://t.me/${u}` };
  const profUrl = PROF[platform]?.(username);
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        color: COLORS[platform] || 0xffffff,
        title: `✅ @${username} is available on ${NAMES[platform] || platform}!`,
        description: profUrl ? `**[Open profile](${profUrl})**` : `**${username}**`,
        footer: { text: 'background scan · kataly.cc/usernamefinder' },
        timestamp: new Date().toISOString(),
      }],
    }),
  }).catch(() => {});
}

// ── Export ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const headers = cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers });

    const url = new URL(request.url);
    const path = url.pathname;
    const p = url.searchParams.get('p');

    // ── Background scan control endpoints ──────────────────────────────────
    if (path === '/bg/start' && request.method === 'POST') {
      if (!env.SCAN_STATE) return Response.json({ error: 'unavailable' }, { status: 503, headers });
      try {
        const body = await request.json();
        if (!body.platform || !['ig', 'tg'].includes(body.platform))
          return Response.json({ error: 'invalid platform' }, { status: 400, headers });
        await env.SCAN_STATE.put('config', JSON.stringify({
          ...body, running: true, started_at: new Date().toISOString(),
        }));
        await env.SCAN_STATE.put('stats', JSON.stringify({ checked: 0, hits: 0 }));
        return Response.json({ ok: true }, { headers });
      } catch { return Response.json({ error: 'error' }, { status: 500, headers }); }
    }

    if (path === '/bg/stop' && request.method === 'POST') {
      if (!env.SCAN_STATE) return Response.json({ ok: true }, { headers });
      const config = await env.SCAN_STATE.get('config', 'json').catch(() => ({})) || {};
      config.running = false;
      await env.SCAN_STATE.put('config', JSON.stringify(config));
      return Response.json({ ok: true }, { headers });
    }

    if (path === '/bg/status') {
      if (!env.SCAN_STATE) return Response.json({ supported: false, running: false }, { headers });
      const [config, stats] = await Promise.all([
        env.SCAN_STATE.get('config', 'json').catch(() => null),
        env.SCAN_STATE.get('stats',  'json').catch(() => null),
      ]);
      return Response.json({
        supported:   true,
        running:     config?.running    || false,
        platform:    config?.platform,
        length:      config?.length,
        charset:     config?.charset,
        checked:     stats?.checked     || 0,
        hits:        stats?.hits        || 0,
        started_at:  config?.started_at,
      }, { headers });
    }

    // ── Batch endpoint (POST ?p=ig|tg) ────────────────────────────────────
    if (request.method === 'POST' && (p === 'ig' || p === 'tg')) {
      try {
        const body = await request.json();
        if (!Array.isArray(body) || body.length > 100 ||
            !body.every(u => /^[a-zA-Z0-9_]{1,32}$/.test(u))) {
          return Response.json({ error: 'invalid' }, { status: 400, headers });
        }
        const igSession  = request.headers.get('X-IG-Session')  || '';
        const tgBotToken = request.headers.get('X-TG-Bot-Token') || '';
        const checkFn = p === 'ig'
          ? (u => checkInstagram(u, igSession))
          : tgBotToken ? (u => checkTelegramBot(u, tgBotToken)) : checkTelegram;
        const results = await Promise.all(
          body.map(async u => { try { return { u, s: await checkFn(u) }; } catch { return { u, s: 'error' }; } })
        );
        return Response.json(results, { headers });
      } catch {
        return Response.json({ error: 'error' }, { status: 500, headers });
      }
    }

    // ── Single-username endpoint (GET) ────────────────────────────────────
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
        const tgBotToken = request.headers.get('X-TG-Bot-Token') || '';
        const status = tgBotToken ? await checkTelegramBot(u, tgBotToken) : await checkTelegram(u);
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

  // ── Cron: fires every minute, checks a batch and posts hits to Discord ──
  async scheduled(event, env, ctx) {
    if (!env.SCAN_STATE) return;

    const config = await env.SCAN_STATE.get('config', 'json').catch(() => null);
    if (!config?.running) return;

    const { platform, charset, ig_session, tg_bot_token } = config;
    const length  = parseInt(config.length) || 3;
    const webhook = config[`webhook_${platform}`] || '';

    if (!['ig', 'tg'].includes(platform)) return;

    const usernames = await bgCombos(charset || 'letters', length, 10);
    if (usernames.length === 0) return;

    const results = await Promise.all(
      usernames.map(async u => {
        try {
          const status = platform === 'ig'
            ? await checkInstagram(u, ig_session || '')
            : tg_bot_token
              ? await checkTelegramBot(u, tg_bot_token)
              : await checkTelegram(u);
          return { u, status };
        } catch { return { u, status: 'error' }; }
      })
    );

    let localHits = 0;
    for (const { u, status } of results) {
      if (status === 'available') {
        localHits++;
        await bgPostHit(u, platform, webhook);
      }
    }

    const stats = await env.SCAN_STATE.get('stats', 'json').catch(() => null) || { checked: 0, hits: 0 };
    await env.SCAN_STATE.put('stats', JSON.stringify({
      checked: stats.checked + usernames.length,
      hits:    stats.hits    + localHits,
    }));
  },
};

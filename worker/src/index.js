const ALLOWED = ['https://kataly.cc', 'http://localhost', 'http://127.0.0.1'];

const DC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DC_SUPER_PROPS = btoa(JSON.stringify({
  os: 'Windows', browser: 'Chrome', device: '', system_locale: 'en-US',
  browser_user_agent: DC_UA, browser_version: '131.0.0.0', os_version: '10',
  referrer: '', referring_domain: '', referrer_current: '', referring_domain_current: '',
  release_channel: 'stable', client_build_number: 369467, client_event_source: null,
}));

function cors(origin) {
  const allowed = ALLOWED.find(o => origin && origin.startsWith(o)) ?? 'https://kataly.cc';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Discord-Token, X-IG-Session, X-TG-Bot-Token',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
  };
}

async function igApiCheck(username, session) {
  const apiHdrs = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'X-IG-App-ID': '936619743392459',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.instagram.com/',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (session) apiHdrs['Cookie'] = `sessionid=${session}`;

  const res = await fetch(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    { headers: apiHdrs, redirect: 'follow' }
  );
  if (res.status === 404) return 'available';
  if (res.status === 429) return 'ratelimit';
  if (res.status === 401 || res.status === 403) return session ? 'invalid_session' : null;
  if (res.status === 200) {
    const data = await res.json().catch(() => null);
    if (!data) return null;
    if (data.status === 'fail' || data.message === 'login_required') return session ? 'invalid_session' : null;
    if (data?.data?.user === null) return 'available';
    if (data?.data?.user) return 'taken';
  }
  return null;
}

async function igHtmlCheck(username, session) {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;

  function parseIgHtml(html, finalUrl) {
    if (finalUrl && finalUrl.includes('/accounts/login/')) return 'login_wall';
    if (
      html.includes('Page Not Found') || html.includes('"pageNotFound"') ||
      html.includes('Sorry, this page') || html.includes("isn't available") ||
      html.includes('"not_found"') || html.includes('page_not_found') ||
      html.includes('"PageNotFound"') || html.includes('"errorPage"')
    ) return 'available';
    // JSON-LD schema present → real profile page
    if (
      html.includes('"@type":"ProfilePage"') || html.includes('"ProfilePage"') ||
      html.includes('"sameAs"') || html.includes('"mainEntityofPage"')
    ) return 'taken';
    if (html.includes('Log in') && !html.includes('"id"')) return 'login_wall';
    if (html.includes('"id"')) return 'taken';
    return null;
  }

  // 1. Try with session if provided
  if (session) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': `sessionid=${session}`,
      },
      redirect: 'follow',
    }).catch(() => null);
    if (res) {
      if (res.status === 404) return 'available';
      if (res.status === 429) return 'ratelimit';
      if (res.status === 200) {
        const html = await res.text().catch(() => '');
        const r = parseIgHtml(html, res.url);
        if (r === 'login_wall') return 'invalid_session';
        if (r) return r;
      }
    }
  }

  // 2. Try with Googlebot UA — Instagram serves real content to crawlers without login wall
  const botRes = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  }).catch(() => null);

  if (botRes) {
    if (botRes.status === 404) return 'available';
    if (botRes.status === 429) return 'ratelimit';
    if (botRes.status === 200) {
      const html = await botRes.text().catch(() => '');
      const r = parseIgHtml(html, botRes.url);
      if (r && r !== 'login_wall') return r;
      // login_wall with bot → fall through to browser check
    }
  }

  // 3. Regular browser UA (no session)
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  }).catch(() => null);

  if (!res) return null;
  if (res.status === 404) return 'available';
  if (res.status === 429) return 'ratelimit';
  if (res.status === 403) return null;
  if (res.status !== 200) return null;
  const html = await res.text().catch(() => '');
  const r = parseIgHtml(html, res.url);
  if (r === 'login_wall') return null;
  return r;
}

async function checkInstagram(username, session) {
  const [apiResult, htmlResult] = await Promise.all([
    igApiCheck(username, session).catch(() => null),
    igHtmlCheck(username, session).catch(() => null),
  ]);
  // Prefer a conclusive result; 'taken'/'available' beat null/'unverified'
  if (apiResult === 'taken' || apiResult === 'available') return apiResult;
  if (htmlResult === 'taken' || htmlResult === 'available') return htmlResult;
  if (apiResult === 'ratelimit' || htmlResult === 'ratelimit') return 'ratelimit';
  if (apiResult === 'invalid_session' || htmlResult === 'invalid_session') return 'invalid_session';
  return session ? 'error' : 'unverified';
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

let _dcFp = { v: '', exp: 0 };

async function getDcFingerprint() {
  if (_dcFp.v && Date.now() < _dcFp.exp) return _dcFp.v;
  try {
    const r = await fetch('https://discord.com/api/v10/auth/fingerprint', {
      headers: {
        'User-Agent': DC_UA,
        'X-Super-Properties': DC_SUPER_PROPS,
        'Accept': '*/*',
        'Origin': 'https://discord.com',
        'Referer': 'https://discord.com/register',
      },
    });
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      if (d.fingerprint) {
        _dcFp = { v: d.fingerprint, exp: Date.now() + 60000 };
        return d.fingerprint;
      }
    }
  } catch {}
  return '';
}

function parseDcResult(data) {
  if (typeof data.taken === 'boolean') return data.taken ? 'taken' : 'available';
  // Alternative formats Discord has used
  if (data.unique_username_type === 0) return 'available';
  if (data.unique_username_type === 1) return 'taken';
  return null;
}

async function checkDiscordAvailable(username, debug = false) {
  const fingerprint = await getDcFingerprint();
  const hdrs = {
    'Content-Type': 'application/json',
    'User-Agent': DC_UA,
    'X-Super-Properties': DC_SUPER_PROPS,
    'X-Discord-Locale': 'en-US',
    'Accept': '*/*',
    'Origin': 'https://discord.com',
    'Referer': 'https://discord.com/register',
  };
  if (fingerprint) hdrs['X-Fingerprint'] = fingerprint;

  try {
    const res = await fetch('https://discord.com/api/v10/unique-username/username-attempt-unauthed', {
      method: 'POST', headers: hdrs, body: JSON.stringify({ username }),
    });
    const body = await res.text();
    if (debug) return { endpoint: 'unauthed', status: res.status, body, fp: fingerprint ? fingerprint.slice(0, 20) + '…' : 'none' };
    if (res.status === 200) {
      const data = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      const r = parseDcResult(data);
      if (r) return r;
    }
    if (res.status === 429) return 'ratelimit';
  } catch (e) {
    if (debug) return { endpoint: 'unauthed', status: 0, body: String(e), fp: 'none' };
  }
  return 'unverified';
}

async function checkDiscordPomelo(username, token, debug = false) {
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me/pomelo-attempt', {
      method: 'POST',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json',
        'User-Agent': DC_UA,
        'X-Super-Properties': DC_SUPER_PROPS,
        'X-Discord-Locale': 'en-US',
        'X-Discord-Timezone': 'America/New_York',
        'Origin': 'https://discord.com',
        'Referer': 'https://discord.com/channels/@me',
      },
      body: JSON.stringify({ username }),
    });
    const body = await res.text();
    if (debug) return { endpoint: 'pomelo', status: res.status, body };
    if (res.status === 200) {
      const data = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      const r = parseDcResult(data);
      if (r) return r;
    }
    if (res.status === 429) return 'ratelimit';
    if (res.status === 401) return 'invalid_token';
  } catch {}
  return 'unverified';
}

async function checkDiscordScan(username, token) {
  // When a token is available, use the authenticated endpoint first — it's more
  // reliable from datacenter IPs because Discord doesn't IP-block authed calls.
  if (token) {
    const pomelo = await checkDiscordPomelo(username, token);
    if (pomelo !== 'unverified') return pomelo;
  }
  // Unauthenticated endpoint (works when Discord doesn't block the datacenter IP).
  return await checkDiscordAvailable(username);
}

async function claimDiscord(username, token) {
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    method: 'PATCH',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json',
      'User-Agent': DC_UA,
      'X-Super-Properties': DC_SUPER_PROPS,
      'Origin': 'https://discord.com',
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
        const isDebug = url.searchParams.get('debug') === '1';
        if (isDebug) {
          const [unauthed, pomelo] = await Promise.all([
            checkDiscordAvailable(u, true),
            token ? checkDiscordPomelo(u, token, true) : Promise.resolve(null),
          ]);
          return Response.json({ unauthed, pomelo }, { headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } });
        }
        if (!token) {
          const status = await checkDiscordAvailable(u);
          return Response.json({ status }, { headers });
        }
        const mode = url.searchParams.get('mode');
        if (mode === 'scan') {
          const status = await checkDiscordScan(u, token);
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

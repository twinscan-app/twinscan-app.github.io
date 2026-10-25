/* TWINSCAN: paste a name or CA, see every Solana coin that shares it.
   Plain browser JS, no build step. Data comes straight from the public
   DexScreener API (https://docs.dexscreener.com/api/reference). */
'use strict';

// ---- Project config: fill these in at launch -------------------------
// Leave `ca` empty until the coin exists. The ticker chip and coin panel
// stay hidden until a valid address is set, so the page never says
// "CA coming soon".
const PROJECT = {
  ticker: 'TWINSCAN', // $TWIN already has several Solana coins on DexScreener
  ca: '',
  x: '',        // e.g. 'https://x.com/twinscan'
  github: '',
};
// ---------------------------------------------------------------------

const API = 'https://api.dexscreener.com';
const HOUR = 3600e3;
const MAX_ENRICH = 24;          // twins that get a full pool lookup, for accurate pair age
const SEARCH_CAP = 30;          // DexScreener returns at most this many pairs per search
const CA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const QUOTES = new Set([
  'So11111111111111111111111111111111111111112',  // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);
const RECENT_KEY = 'twinscan:recent';

const $ = (sel) => document.querySelector(sel);

// ---------- DOM helpers (all API text goes through textContent) ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

const svg = (inner, filled) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" ${filled
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${inner}</svg>`;

const ICONS = {
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h9M3 6h.01M3 12h.01M3 18h.01"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  out: svg('<path d="M7 17 17 7M8 7h9v9"/>'),
  web: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>'),
  twitter: svg('<path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z"/>', true),
  telegram: svg('<path d="M21.9 4.3 18.7 19.4c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.2 13l-4.8-1.5c-1-.3-1.1-1 .2-1.5L20.5 2.8c.9-.3 1.7.2 1.4 1.5Z"/>', true),
};

function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = ICONS[name] || ICONS.link;
  const el = t.content.firstChild;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

const ext = { target: '_blank', rel: 'noopener noreferrer nofollow' };

// ---------- formatting ----------

function norm(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function ago(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return m + 'm';
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}h ${m % 60}m`;
  const d = Math.floor(hr / 24);
  if (d < 31) return `${d}d ${hr % 24}h`;
  const mo = Math.floor(d / 30.44);
  if (mo < 12) return `${mo}mo ${Math.min(29, Math.floor(d - mo * 30.44))}d`;
  const y = Math.floor(d / 365.25);
  return `${y}y ${Math.min(11, Math.floor((d - y * 365.25) / 30.44))}mo`;
}

function usd(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [v, s] of units) {
    if (Math.abs(n) >= v) {
      const x = n / v;
      return '$' + (x >= 100 ? x.toFixed(0) : x.toFixed(x >= 10 ? 1 : 2)) + s;
    }
  }
  return '$' + Math.round(n);
}

const short = (ca) => `${ca.slice(0, 4)}…${ca.slice(-4)}`;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const dateStr = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const pumpUrl = (ca) => `https://pump.fun/coin/${ca}`;
const dexUrl = (ca) => `https://dexscreener.com/solana/${ca}`;

function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

// Key used to spot two coins listing the same site or social account.
function linkKey(u) {
  try {
    const url = new URL(u);
    let host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'twitter.com' || host === 'mobile.twitter.com') host = 'x.com';
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    if (!path && ['x.com', 't.me', 'telegram.me', 'discord.gg', 'discord.com', 'pump.fun', 'dexscreener.com'].includes(host)) return null;
    return host + path;
  } catch { return null; }
}

// ---------- DexScreener API ----------

class HttpError extends Error {
  constructor(status) { super(`HTTP ${status}`); this.status = status; }
}

async function getJSON(path, signal) {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, 12000);
  const stop = () => ctl.abort();
  signal.addEventListener('abort', stop);
  try {
    const res = await fetch(API + path, { signal: ctl.signal });
    if (!res.ok) throw new HttpError(res.status);
    return await res.json();
  } catch (e) {
    if (timedOut) throw new Error('timeout');
    throw e;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

// A 4xx (other than 429) on a lookup just means "nothing here".
async function soft(promise) {
  try { return await promise; } catch (e) {
    if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429) return [];
    throw e;
  }
}

const api = {
  search: (q, s) => getJSON('/latest/dex/search?q=' + encodeURIComponent(q), s).then((d) => d.pairs || []),
  tokenPairs: (ca, s) => soft(getJSON('/token-pairs/v1/solana/' + ca, s)).then((d) => (Array.isArray(d) ? d : [])),
  pair: (addr, s) => soft(getJSON('/latest/dex/pairs/solana/' + addr, s)).then((d) => d.pairs || (d.pair ? [d.pair] : [])),
};

async function pool(items, n, fn) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// ---------- scan ----------

function parseInput(raw) {
  const s = String(raw || '').trim().slice(0, 120);
  if (!s) return null;
  if (CA_RE.test(s)) return { raw: s, ca: s };
  if (!/\s/.test(s) && /[/.]/.test(s)) {
    // A pasted pump.fun / solscan / birdeye link: take the address out of it.
    const found = s.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
    if (found) return { raw: found[found.length - 1], ca: found[found.length - 1] };
    if (/^https?:\/\//i.test(s)) return { raw: s, badLink: true };
  }
  const term = s.replace(/^\$+/, '').trim();
  if (norm(term).length < 2) return { raw: s, tooShort: true };
  return { raw: s, term };
}

function addPairs(tokens, pairs) {
  for (const p of pairs) {
    const b = p && p.chainId === 'solana' && p.baseToken;
    if (!b || !b.address || QUOTES.has(b.address)) continue;
    let t = tokens.get(b.address);
    if (!t) tokens.set(b.address, (t = { address: b.address, name: b.name || '', symbol: b.symbol || '', pairs: new Map() }));
    t.pairs.set(p.pairAddress, p);
  }
}

function addOwnPairs(t, pairs) {
  for (const p of pairs) if (p && p.chainId === 'solana' && p.pairAddress) t.pairs.set(p.pairAddress, p);
}

const seenAge = (t) => Math.min(...[...t.pairs.values()].map((p) => p.pairCreatedAt || Infinity));

async function runScan(input, signal, progress) {
  const tokens = new Map();
  const notes = [];
  let target = null;
  let keys;
  let queries;

  if (input.ca) {
    progress('Looking up this CA on DexScreener…');
    let pairs = await api.tokenPairs(input.ca, signal);
    let side = findSide(pairs, input.ca);
    if (!side) {
      // Maybe a pair (pool) address was pasted instead of the mint.
      pairs = await api.pair(input.ca, signal);
      side = findSide(pairs, input.ca);
    }
    if (!side) return { kind: 'unknown-ca', input };
    target = side;
    addPairs(tokens, pairs);
    if (!tokens.has(side.address)) tokens.set(side.address, { ...side, pairs: new Map() });
    const t = tokens.get(side.address);
    if (side.address === input.ca) addOwnPairs(t, pairs);
    t.enriched = side.address === input.ca;
    keys = new Set([norm(side.symbol), norm(side.name)].filter((k) => k.length >= 2));
    queries = [side.symbol, '$' + side.symbol, side.name, side.symbol + ' pump'];
  } else {
    keys = new Set([norm(input.term)]);
    queries = [input.term, '$' + input.term, input.term + ' sol', input.term + ' pump'];
  }

  queries = [...new Map(queries.map((q) => q.trim()).filter((q) => norm(q).length >= 2)
    .map((q) => [q.toLowerCase(), q])).values()];

  progress('Searching DexScreener for twins…');
  const settled = await Promise.allSettled(queries.map((q) => api.search(q, signal)));
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  const ok = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failed = settled.filter((r) => r.status === 'rejected').map((r) => r.reason);
  if (!ok.length && !target) throw failed.find((e) => e.status === 429) || failed[0];
  if (failed.length) notes.push('Some DexScreener searches failed, so this list may be missing coins. Rescan in a minute.');
  const capped = ok.some((pairs) => pairs.length >= SEARCH_CAP);
  ok.forEach((pairs) => addPairs(tokens, pairs));

  const matchOf = (t) => {
    if (target && t.address === target.address) return { ticker: true, name: true };
    const ticker = keys.has(norm(t.symbol));
    const name = keys.has(norm(t.name));
    return ticker || name ? { ticker, name } : null;
  };

  const all = [...tokens.values()];
  const twins = all.filter((t) => (t.match = matchOf(t)));
  const looseKeys = [...keys].filter((k) => k.length >= 3);
  const similar = all.filter((t) => !t.match && looseKeys.some((k) => norm(t.symbol).includes(k) || norm(t.name).includes(k)));

  // Search results only carry some pools per coin. Fetch each twin's full
  // pool list so "pair age" is its first pool, not just the one search found.
  twins.sort((a, b) => seenAge(a) - seenAge(b));
  const todo = twins.filter((t) => !t.enriched).slice(0, MAX_ENRICH);
  if (todo.length) progress(`Checking ${plural(twins.length, 'coin')} for pair age and links…`);
  let limited = false;
  await pool(todo, 6, async (t) => {
    if (limited) return;
    try { addOwnPairs(t, await api.tokenPairs(t.address, signal)); }
    catch (e) {
      if (signal.aborted) throw e;
      if (e.status === 429) limited = true;
    }
  });
  if (limited) notes.push('DexScreener rate-limited part of this scan, so some ages and stats come from search results only.');
  if (twins.filter((t) => !t.enriched).length > MAX_ENRICH) notes.push(`Pair ages after the first ${MAX_ENRICH} coins come from search results only.`);
  if (capped) notes.push(`DexScreener returns up to ${SEARCH_CAP} pairs per search, so a very crowded name can have more twins than listed here.`);

  const rows = twins.map(summarize).sort(byAge);
  addFlags(rows);
  return {
    kind: 'ok',
    input,
    target,
    twins: rows,
    similar: similar.map(summarize).sort(byAge).slice(0, 40),
    notes,
    scannedAt: Date.now(),
  };
}

function findSide(pairs, ca) {
  for (const p of pairs) {
    if (!p || p.chainId !== 'solana') continue;
    if (p.baseToken && p.baseToken.address === ca) return pick(p.baseToken);
    if (p.quoteToken && p.quoteToken.address === ca) return pick(p.quoteToken);
    if (p.pairAddress === ca && p.baseToken) return pick(p.baseToken);
  }
  return null;
}
const pick = (t) => ({ address: t.address, name: t.name || '', symbol: t.symbol || '' });

// Liquidity that a faked price cannot inflate: never more than twice the
// SOL/USDC side of the pool. Null when DexScreener reports none (pump.fun curve).
function liqOf(p) {
  if (!p.liquidity) return null;
  const total = Number(p.liquidity.usd) || 0;
  const quote = Number(p.liquidity && p.liquidity.quote);
  const pu = Number(p.priceUsd);
  const pn = Number(p.priceNative);
  if (Number.isFinite(quote) && pu > 0 && pn > 0) return Math.min(total, 2 * quote * (pu / pn));
  return total;
}

function summarize(t) {
  const pairs = [...t.pairs.values()];
  const times = pairs.map((p) => p.pairCreatedAt).filter((x) => Number.isFinite(x) && x > 0);
  const createdAt = times.length ? Math.min(...times) : null;
  const based = pairs.filter((p) => p.baseToken && p.baseToken.address === t.address);
  const main = (based.length ? based : pairs).reduce((a, b) => ((liqOf(b) || 0) > (liqOf(a) || 0) ? b : a), (based.length ? based : pairs)[0]);
  const liqs = pairs.map(liqOf).filter((x) => x != null);
  const info = pairs.map((p) => p.info).filter(Boolean)
    .sort((a, b) => linkList(b).length - linkList(a).length)[0] || null;
  const links = info ? linkList(info) : [];
  const meta = (main && main.baseToken && main.baseToken.address === t.address) ? main.baseToken : t;
  const txns = pairs.reduce((s, p) => s + ((p.txns && p.txns.h24 && (p.txns.h24.buys + p.txns.h24.sells)) || 0), 0);
  return {
    address: t.address,
    name: meta.name || t.name || '(no name)',
    symbol: meta.symbol || t.symbol || '',
    match: t.match,
    isTarget: false,
    createdAt,
    mcap: main ? (main.marketCap != null ? main.marketCap : main.fdv != null ? main.fdv : null) : null,
    vol: pairs.reduce((s, p) => s + ((p.volume && p.volume.h24) || 0), 0),
    liq: liqs.length ? liqs.reduce((s, x) => s + x, 0) : null,
    onCurve: pairs.length > 0 && pairs.every((p) => p.dexId === 'pumpfun'),
    txns,
    image: info ? safeUrl(info.imageUrl) : null,
    hasProfile: !!(info && (info.imageUrl || info.header)),
    links,
    chart: (main && safeUrl(main.url)) || dexUrl(t.address),
    onPump: t.address.endsWith('pump') || pairs.some((p) => p.dexId === 'pumpfun' || p.dexId === 'pumpswap'),
    pools: pairs.length,
    flags: [],
  };
}

function linkList(info) {
  const out = [];
  for (const w of info.websites || []) {
    const url = safeUrl(w.url);
    if (url) out.push({ kind: 'web', label: w.label || 'Website', url });
  }
  for (const s of info.socials || []) {
    const url = safeUrl(s.url);
    if (!url) continue;
    const type = String(s.type || s.platform || '').toLowerCase();
    const label = { twitter: 'X', telegram: 'Telegram', discord: 'Discord', tiktok: 'TikTok', instagram: 'Instagram' }[type] || 'Link';
    out.push({ kind: type === 'twitter' || type === 'telegram' ? type : type === 'discord' ? 'chat' : 'link', label, url });
  }
  return out;
}

const byAge = (a, b) => (a.createdAt || Infinity) - (b.createdAt || Infinity) || (b.mcap || 0) - (a.mcap || 0);

// Facts only. Each flag is something anyone can check on DexScreener.
function addFlags(rows) {
  const n = rows.length;
  const oldest = rows[0];
  const withLinks = rows.filter((r) => r.hasProfile && r.links.length);
  const firstUse = new Map();
  rows.forEach((r, i) => {
    if (i === 0 && n > 1 && r.createdAt) r.flags.push(['oldest', 'Oldest pair']);
    if (n > 1 && withLinks.length === 1 && withLinks[0] === r) r.flags.push(['profile', 'Only one with a profile and links']);
    if (!r.hasProfile && !r.links.length) r.flags.push(['none', 'No profile and no links']);
    if (i > 0 && oldest.createdAt && r.createdAt && r.createdAt - oldest.createdAt < HOUR) r.flags.push(['fast', 'Launched within 1 hour of the oldest']);
    const keys = r.links.map((l) => linkKey(l.url)).filter(Boolean);
    const reused = keys.map((k) => firstUse.get(k)).filter((j) => j != null && j !== i);
    if (reused.length) r.flags.push(['copy', `Same links as #${Math.min(...reused) + 1}`]);
    keys.forEach((k) => { if (!firstUse.has(k)) firstUse.set(k, i); });
  });
}

// ---------- rendering ----------

const results = $('#results');
const form = $('#search');
const field = $('#q');
let current = null;

function copyBtn(text, label, cls = 'mini') {
  const b = h('button', { class: cls, type: 'button', title: label, 'aria-label': label }, icon('copy'), cls === 'mini' ? 'Copy' : label);
  const idle = [...b.childNodes];
  let timer = 0;
  b.addEventListener('click', async () => {
    const ok = await copyText(typeof text === 'function' ? text() : text);
    clearTimeout(timer);
    b.replaceChildren(icon(ok ? 'check' : 'copy'), ok ? 'Copied' : 'Copy failed');
    b.classList.add('done');
    timer = setTimeout(() => { b.replaceChildren(...idle); b.classList.remove('done'); }, 1500);
  });
  return b;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = h('textarea', { class: 'sr-only', readonly: true });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

function avatar(r) {
  const fallback = () => h('span', { class: 'avatar', 'aria-hidden': 'true' }, (r.symbol || r.name || '?').replace(/^\$/, '').slice(0, 2).toUpperCase());
  if (!r.image) return fallback();
  const img = h('img', { class: 'avatar', src: r.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', width: 38, height: 38 });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

function cell(cls, label, main, sub, title) {
  return h('div', { class: `cell ${cls}`, title },
    h('span', { class: 'lbl' }, label),
    h('div', { class: 'num' }, main),
    sub ? h('div', { class: 'sub' }, sub) : null);
}

function rowEl(r, i, list, ranked) {
  const oldest = list[0];
  let ageSub = r.createdAt ? new Date(r.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null;
  if (ranked && i === 0 && list.length > 1) ageSub = 'oldest';
  else if (ranked && i > 0 && r.createdAt && oldest.createdAt) {
    const d = r.createdAt - oldest.createdAt;
    ageSub = d < 60000 ? 'same minute as #1' : `+${ago(d)} after #1`;
  }
  const match = r.match ? (r.match.ticker && r.match.name ? 'Same name and ticker' : r.match.ticker ? 'Same ticker' : 'Same name') : null;
  const flags = r.flags.slice();
  if (r.isTarget) flags.unshift(['you', 'The CA you pasted']);

  const links = r.links.length || r.hasProfile
    ? h('div', { class: 'cell c-links' },
      h('span', { class: 'lbl' }, 'Profile & links'),
      h('div', { class: 'links' },
        h('span', { class: 'prof' }, r.hasProfile ? 'Profile' : 'No profile'),
        r.links.slice(0, 5).map((l) => h('a', { class: 'mini', href: l.url, ...ext, title: `${l.label}: ${l.url}`, 'aria-label': `${l.label} (opens new tab)` }, icon(l.kind))),
        r.hasProfile && !r.links.length ? h('span', { class: 'none' }, '· no links') : null))
    : h('div', { class: 'cell c-links' }, h('span', { class: 'lbl' }, 'Profile & links'), h('span', { class: 'none' }, 'None'));

  return h('li', { class: 'row' + (r.isTarget ? ' you' : '') },
    h('div', { class: 'rank' }, ranked ? `#${i + 1}` : ''),
    h('div', { class: 'c-coin coin' },
      avatar(r),
      h('div', { class: 'coin-text' },
        h('div', { class: 'coin-name' }, r.name, r.symbol ? h('span', { class: 'sym' }, '$' + r.symbol.replace(/^\$/, '')) : null),
        h('div', { class: 'coin-meta' }, [match, plural(r.pools, 'pool')].filter(Boolean).join(' · ')),
        flags.length ? h('div', { class: 'flags' }, flags.map(([k, text]) => h('span', { class: `flag f-${k}` }, text))) : null)),
    cell('c-age', 'Pair age', r.createdAt ? ago(Date.now() - r.createdAt) : '—', ageSub, r.createdAt ? `First pair: ${dateStr(r.createdAt)}` : null),
    cell('c-mcap', 'Market cap', usd(r.mcap), r.onCurve ? 'on pump.fun curve' : `liq ${usd(r.liq)}`),
    cell('c-vol', 'Vol 24h', usd(r.vol), r.txns ? `${r.txns.toLocaleString()} txns` : null),
    links,
    h('div', { class: 'cell c-ca' },
      h('span', { class: 'lbl' }, 'Contract address'),
      h('div', { class: 'ca' },
        h('code', { title: r.address }, short(r.address)),
        copyBtn(r.address, `Copy CA ${r.address}`),
        h('a', { class: 'mini', href: r.chart, ...ext, title: 'Open on DexScreener' }, 'Dex', icon('out')),
        r.onPump ? h('a', { class: 'mini', href: pumpUrl(r.address), ...ext, title: 'Open on pump.fun' }, 'Pump', icon('out')) : null)));
}

function tableEl(list, ranked) {
  return h('ol', { class: 'rows' },
    h('li', { class: 'row head', 'aria-hidden': 'true' },
      h('div', null, '#'), h('div', null, 'Coin'), h('div', null, 'Pair age'), h('div', null, 'Market cap'),
      h('div', null, 'Vol 24h'), h('div', null, 'Profile & links'), h('div', { class: 'c-ca' }, 'CA')),
    list.map((r, i) => rowEl(r, i, list, ranked)));
}

function subjectOf(res) {
  return res.target ? `${res.target.name} ($${res.target.symbol.replace(/^\$/, '')})` : res.input.term;
}

function factsOf(res) {
  const t = res.twins;
  const out = [];
  if (!t.length) return out;
  const o = t[0];
  if (t.length > 1 && o.createdAt) out.push({ c: 'var(--accent-text)', parts: ['Oldest pair: ', ['#1 ' + o.name], ` · ${short(o.address)} · ${ago(Date.now() - o.createdAt)} old`], text: `Oldest pair: ${o.name} ($${o.symbol}), ${ago(Date.now() - o.createdAt)} old\nCA: ${o.address}` });
  const withLinks = t.filter((r) => r.hasProfile && r.links.length);
  if (t.length > 1) {
    if (withLinks.length === 1) {
      const k = t.indexOf(withLinks[0]) + 1;
      out.push({ c: 'var(--blue)', parts: ['Only one with a profile and links: ', [`#${k}`]], text: `Only one with a profile and links: #${k} (${short(withLinks[0].address)})` });
    } else {
      out.push({ c: 'var(--blue)', parts: [[String(withLinks.length)], ' with a profile and links'], text: `With a profile and links: ${withLinks.length}` });
    }
  }
  const fast = t.filter((r) => r.flags.some(([k]) => k === 'fast')).length;
  if (t.length > 1) out.push({ c: 'var(--orange)', parts: [[String(fast)], ' launched within 1 hour of the oldest'], text: `Launched within 1h of the oldest: ${fast}` });
  const none = t.filter((r) => !r.hasProfile && !r.links.length).length;
  out.push({ c: 'var(--amber)', parts: [[String(none)], ' with no profile and no links'], text: `No profile and no links: ${none}` });
  const copies = t.filter((r) => r.flags.some(([k]) => k === 'copy')).length;
  if (copies) out.push({ c: 'var(--pink)', parts: [[String(copies)], ' reuse links from an older coin'], text: `Reuse links from an older coin: ${copies}` });
  return out;
}

function shareUrl(q) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('q', q);
  return u.href;
}

function summaryText(res) {
  const n = res.twins.length;
  return [
    `TWINSCAN: ${plural(n, 'Solana coin')} ${n === 1 ? 'uses' : 'share'} the name/ticker "${subjectOf(res)}"`,
    ...factsOf(res).map((f) => f.text),
    shareUrl(res.input.raw),
    'Facts from DexScreener. It cannot prove which coin the real team made.',
  ].join('\n');
}

function renderResult(res) {
  document.body.classList.add('scanned');
  const n = res.twins.length;
  const time = new Date(res.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (!n) {
    show(h('div', { class: 'panel' },
      h('div', { class: 'state' },
        h('h3', null, `No Solana coin named "${subjectOf(res)}" on DexScreener`),
        h('p', null, 'Check the spelling, try the ticker, or paste the contract address instead. Brand-new pump.fun coins can take a minute to appear.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => scan(res.input.raw, { push: false }) }, icon('refresh'), 'Rescan')))),
    res.similar.length ? similarEl(res.similar, true) : null);
    return;
  }

  const title = res.target
    ? [plural(n, 'coin'), n === 1 ? ' uses the name or ticker of ' : ' share the name or ticker of ', h('q', null, subjectOf(res))]
    : [plural(n, 'coin'), n === 1 ? ' uses ' : ' share ', h('q', null, subjectOf(res))];

  const panel = h('div', { class: 'panel' },
    h('div', { class: 'res-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, h('span', { class: 'live', 'aria-hidden': 'true' }), `Solana · DexScreener · ${time}`),
        h('h2', null, title),
        h('p', { class: 'sub' }, n === 1 ? 'No twins on DexScreener right now. Only this coin uses this name or ticker.' : 'Sorted by pair age, oldest first.')),
      h('div', { class: 'actions' },
        copyBtn(() => shareUrl(res.input.raw), 'Copy share link', 'btn'),
        copyBtn(() => summaryText(res), 'Copy summary', 'btn'),
        h('button', { class: 'btn', type: 'button', onclick: () => scan(res.input.raw, { push: false }) }, icon('refresh'), 'Rescan'))),
    h('ul', { class: 'facts' }, factsOf(res).map((f) => h('li', null,
      h('span', { class: 'dot', 'data-c': f.c }),
      h('span', null, f.parts.map((p) => (Array.isArray(p) ? h('b', null, p[0]) : p)))))),
    tableEl(res.twins, true),
    res.notes.length ? h('div', { class: 'notes' }, res.notes.map((t) => h('div', null, t))) : null);

  // Dot colours are set through CSSOM so the page needs no inline-style CSP exception.
  panel.querySelectorAll('.dot[data-c]').forEach((d) => d.style.setProperty('--c', d.dataset.c));

  show(panel,
    res.similar.length ? similarEl(res.similar, false) : null,
    h('p', { class: 'disclaimer' }, 'TWINSCAN shows facts from DexScreener. It cannot prove which coin the real team made. Check the team\'s own X or website for the CA.'));
}

function similarEl(list, open) {
  return h('details', { class: 'panel similar', open },
    h('summary', null, `${plural(list.length, 'similar name')} (not exact matches)`),
    tableEl(list, false));
}

// Like replaceChildren, but skips null/false so optional parts can be inline.
function show(...kids) {
  results.replaceChildren(...kids.flat().filter(Boolean));
}

function renderLoading(text) {
  results.replaceChildren(h('div', { class: 'panel loading', 'aria-busy': 'true' },
    h('div', { class: 'status' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), h('span', { id: 'progress' }, text)),
    h('div', { class: 'skel' }), h('div', { class: 'skel' }), h('div', { class: 'skel' })));
}

function renderState(kind, title, text, extra) {
  results.replaceChildren(h('div', { class: 'panel' },
    h('div', { class: `state ${kind}` }, h('h3', null, title), h('p', null, text),
      extra ? h('div', { class: 'actions' }, extra) : null)));
}

function renderError(e, input) {
  const retry = h('button', { class: 'btn', type: 'button', onclick: () => scan(input.raw, { push: false }) }, icon('refresh'), 'Try again');
  if (e && e.status === 429) {
    renderState('error', 'DexScreener is rate-limiting this connection',
      'Their free API allows a few hundred requests a minute per IP. Wait about a minute, then try again.', retry);
  } else if (e instanceof HttpError) {
    renderState('error', `DexScreener returned an error (HTTP ${e.status})`, 'Their API may be having trouble. Try again in a moment.', retry);
  } else {
    renderState('error', 'Could not reach DexScreener',
      'Check your connection. Ad or privacy blockers can also block api.dexscreener.com.', retry);
  }
}

// ---------- flow ----------

async function scan(raw, { push = true } = {}) {
  const input = parseInput(raw);
  if (!input) { field.focus(); return; }
  if (input.tooShort || input.badLink) {
    renderState('', input.badLink ? 'No contract address in that link' : 'Type at least 2 letters',
      'Use a name, a ticker like $WIF, or a full contract address.');
    return;
  }
  field.value = input.raw;
  setUrl(input.raw, push);
  document.title = `${input.ca ? short(input.ca) : input.term} · TWINSCAN`;

  if (current) current.abort();
  const ctl = (current = new AbortController());
  document.body.classList.add('scanned');
  renderLoading('Searching DexScreener…');
  const progress = (text) => { const el = $('#progress'); if (el && !ctl.signal.aborted) el.textContent = text; };

  try {
    const res = await runScan(input, ctl.signal, progress);
    if (ctl.signal.aborted) return;
    if (res.kind === 'unknown-ca') {
      renderState('', 'DexScreener has no pairs for this address',
        'Check the CA. Brand-new pump.fun coins can take a minute to show up on DexScreener.',
        [h('a', { class: 'btn', href: pumpUrl(input.ca), ...ext }, 'Open on pump.fun', icon('out')),
          h('button', { class: 'btn', type: 'button', onclick: () => scan(input.raw, { push: false }) }, icon('refresh'), 'Rescan')]);
    } else {
      if (res.target) res.twins.forEach((r) => { r.isTarget = r.address === res.target.address; });
      renderResult(res);
    }
    remember(input.raw);
  } catch (e) {
    if (ctl.signal.aborted) return;
    console.error(e);
    renderError(e, input);
  } finally {
    if (current === ctl) current = null;
  }
}

function setUrl(q, push) {
  const href = shareUrl(q);
  if (href === location.href) return;
  history[push ? 'pushState' : 'replaceState'](null, '', href);
}

function remember(q) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((x) => typeof x === 'string' && x.toLowerCase() !== q.toLowerCase());
    list.unshift(q);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch { /* storage blocked: recent list is optional */ }
  showRecent();
}

function showRecent() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((x) => typeof x === 'string'); } catch { list = []; }
  const box = $('#recent');
  box.hidden = !list.length;
  box.replaceChildren(h('span', null, 'Recent'),
    ...list.map((q) => h('button', { class: 'chip', type: 'button', 'data-q': q, title: q }, CA_RE.test(q) ? short(q) : q)));
}

function initProject() {
  const setLink = (id, url) => {
    const a = document.getElementById(id);
    const safe = url && safeUrl(url);
    if (a && safe) { a.href = safe; a.hidden = false; }
  };
  setLink('link-github', PROJECT.github);
  setLink('foot-github', PROJECT.github);
  setLink('link-x', PROJECT.x);
  if (!CA_RE.test(PROJECT.ca)) return;
  const ticker = '$' + PROJECT.ticker.replace(/^\$/, '');
  document.querySelectorAll('[data-ticker]').forEach((el) => { el.textContent = ticker; el.hidden = false; });
  $('#coin-ca').append(
    h('code', { title: PROJECT.ca }, PROJECT.ca),
    copyBtn(PROJECT.ca, 'Copy CA', 'btn'),
    h('a', { class: 'btn btn-buy', href: pumpUrl(PROJECT.ca), ...ext }, `Buy ${ticker} on pump.fun`),
    h('a', { class: 'btn', href: dexUrl(PROJECT.ca), ...ext }, 'Chart', icon('out')),
    h('button', { class: 'btn', type: 'button', onclick: () => { scan(PROJECT.ca); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, `Scan ${ticker} for twins`));
  $('#coin').hidden = false;
}

form.addEventListener('submit', (e) => { e.preventDefault(); scan(field.value); });
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip[data-q]');
  if (chip) scan(chip.dataset.q);
});
window.addEventListener('popstate', () => {
  const q = new URLSearchParams(location.search).get('q');
  if (q) scan(q, { push: false });
  else { if (current) current.abort(); results.replaceChildren(); document.body.classList.remove('scanned'); field.value = ''; document.title = 'TWINSCAN · Which coin is the real one?'; }
});

initProject();
showRecent();
const startQ = new URLSearchParams(location.search).get('q');
if (startQ) scan(startQ, { push: false });

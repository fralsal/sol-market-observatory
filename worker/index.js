const API = "https://api.taskmarket.dev/api/";
const CHAINS = new Set(["4217", "8453"]);
const RANGES = new Set(["7d", "30d", "90d", "all"]);
const VIEWS = { overview: "Market Observatory", activity: "Market activity", posters: "Task posters" };
const CACHE_SECONDS = 120;
const localCache = new Map();
const inflight = new Map();

async function upstream(path, parameters) {
  const url = new URL(path, API);
  url.search = new URLSearchParams(parameters).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(url.href, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Taskmarket ${path} returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function cached(request, context, refresh, ttl = CACHE_SECONDS) {
  const cache = globalThis.caches?.default;
  const key = request.url;
  let previous = localCache.get(key);
  if (cache && !previous) {
    try {
      const hit = await cache.match(request);
      if (hit) previous = await hit.json();
    } catch (error) {
      console.warn("Market cache read:", error.name);
    }
  }
  if (previous && Date.now() - Date.parse(previous.asOf) < ttl * 1000) return previous;
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      const result = { ...(await refresh()), asOf: new Date().toISOString() };
      if (localCache.size >= 96) localCache.delete(localCache.keys().next().value);
      localCache.set(key, result);
      if (cache) {
        const write = cache.put(request, Response.json(result, {
          headers: { "cache-control": "public, max-age=86400" },
        })).catch(error => console.warn("Market cache write:", error.name));
        if (context?.waitUntil) context.waitUntil(write);
        else await write;
      }
      return result;
    })().finally(() => inflight.delete(key)));
  }
  try {
    return await inflight.get(key);
  } catch (error) {
    if (!previous) throw error;
    return { ...previous, stale: true };
  }
}

async function overview(chainId, range) {
  const bucket = range === "90d" || range === "all" ? "week" : "day";
  const [stats, breakdowns, series, recent] = await Promise.all([
    upstream("market/stats", { chainId }),
    upstream("stats/breakdowns", {}),
    upstream("stats/platform-time-series", { range, bucket }),
    upstream("tasks", { chainId, sort: "newest", limit: "30" }),
  ]);
  return { stats, breakdowns, series, bucket, recent: recent.tasks.map(taskSummary) };
}

function taskSummary(task) {
  return {
    id: task.id, title: task.description?.split("\n")[0]?.slice(0, 155) || "Untitled task",
    createdAt: task.createdAt, submissions: task.submissionCount, reward: task.reward, mode: task.mode,
  };
}

async function activity(range, cursor) {
  const feedParameters = { limit: "18" };
  if (cursor) return { feed: await upstream("stats/activity-feed", { ...feedParameters, cursor }) };
  const [heatmap, byMode, feed] = await Promise.all([
    upstream("stats/activity-heatmap", { range, dimension: "hourOfWeek" }),
    upstream("stats/activity-heatmap", { range, dimension: "mode" }),
    upstream("stats/activity-feed", feedParameters),
  ]);
  return { heatmap, byMode, feed };
}

function monday(time) {
  const day = new Date(time);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  day.setUTCHours(0, 0, 0, 0);
  return day.toISOString().slice(0, 10);
}

async function posterWeek(chainId, start, end) {
  const counts = new Map();
  const seen = new Set();
  let cursor = end > Date.now() ? undefined : new Date(end).toISOString();
  let complete = false;
  for (let index = 0; index < 7; index++) {
    const page = await upstream("tasks", { chainId, sort: "newest", limit: "100", ...(cursor ? { cursor } : {}) });
    let crossedStart = false;
    for (const task of page.tasks) {
      const created = Date.parse(task.createdAt);
      if (created < start) crossedStart = true;
      if (!(created >= start && created < end) || seen.has(task.id) || !task.requester) continue;
      seen.add(task.id);
      const requester = task.requester.toLowerCase();
      counts.set(requester, (counts.get(requester) || 0) + 1);
    }
    if (crossedStart || !page.hasMore) {
      complete = true;
      break;
    }
    if (!page.nextCursor || cursor === page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return { week: monday(start), posters: counts.size, tasks: seen.size,
    topPosted: Math.max(0, ...counts.values()), complete };
}

async function posters(chainId) {
  const weekMs = 7 * 86400000;
  const oldest = Date.parse(monday(Date.now())) - 5 * weekMs;
  const weeks = await Promise.all(Array.from({ length: 6 }, (_, index) => {
    const start = oldest + index * weekMs;
    return posterWeek(chainId, start, start + weekMs);
  }));
  return { weeks };
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function staticResponse(asset) {
  const content = asset.binary ? Uint8Array.from(atob(asset.body), letter => letter.charCodeAt(0)) : asset.body;
  return new Response(content, { headers: {
    "content-type": asset.type,
    "cache-control": "public, max-age=86400",
    "x-content-type-options": "nosniff",
  } });
}

function documentResponse(url, view) {
  const title = VIEWS[view];
  const chain = CHAINS.has(url.searchParams.get("chain")) ? url.searchParams.get("chain") : "4217";
  const canonical = new URL(view === "overview" ? "/" : "/" + view, url.origin);
  if (chain === "8453") canonical.searchParams.set("chain", chain);
  const range = url.searchParams.get("range");
  if (RANGES.has(range) && range !== "30d" && view !== "posters") canonical.searchParams.set("range", range);
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  return new Response(PAGE.replaceAll("__TITLE__", htmlEscape(title))
    .replaceAll("__CANONICAL__", htmlEscape(canonical.href))
    .replaceAll("__SHARE__", htmlEscape(new URL(`/assets/share-${view}.png`, url.origin).href))
    .replaceAll("__VIEW__", view), { headers });
}

export default {
  async fetch(request, env, context) {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const url = new URL(request.url);
    if (Object.hasOwn(ASSETS, url.pathname)) return staticResponse(ASSETS[url.pathname]);
    const view = url.pathname === "/" ? "overview" : url.pathname.slice(1);
    if (Object.hasOwn(VIEWS, view)) return documentResponse(url, view);
    const endpoint = url.pathname.match(/^\/data\/(overview|activity|posters)$/)?.[1];
    if (!endpoint) return new Response("Page not found", { status: 404 });
    const chain = url.searchParams.get("chain") ?? "4217";
    const range = url.searchParams.get("range") ?? "30d";
    const cursor = url.searchParams.get("cursor");
    if (!CHAINS.has(chain) || !RANGES.has(range) || (cursor && (endpoint !== "activity" ||
      cursor.length > 35 || !/^\d{4}-\d{2}-\d{2}T/.test(cursor) || !Number.isFinite(Date.parse(cursor))))) {
      return new Response("Invalid filter", { status: 400 });
    }
    const key = new URL(url.pathname, url.origin);
    if (endpoint !== "activity") key.searchParams.set("chain", chain);
    if (endpoint !== "posters") key.searchParams.set("range", range);
    if (cursor) key.searchParams.set("cursor", cursor);
    try {
      const result = await cached(new Request(key), context, () => {
        if (endpoint === "overview") return overview(chain, range);
        if (endpoint === "activity") return activity(range, cursor);
        return posters(chain);
      }, endpoint === "posters" ? 600 : CACHE_SECONDS);
      return Response.json(result, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      console.error("Market data:", String(error).slice(0, 190));
      return Response.json({ error: "Taskmarket data is temporarily unavailable." }, { status: 502 });
    }
  },
};

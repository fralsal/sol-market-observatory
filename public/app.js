"use strict";

const dashboard = document.querySelector("#dashboard");
const snapshot = document.querySelector("#snapshot");
const view = document.body.dataset.view;
const chains = { "4217": ["Tempo", "OUSD"], "8453": ["Base", "USDC"] };
const ranges = ["7d", "30d", "90d", "all"];
const heading = {
  activity: ["Market <em>activity</em>", "See when work happens and follow the latest public events."],
  posters: ["Task <em>posters</em>", "See how many different wallets post work each week."],
};
const params = new URLSearchParams(location.search);
let chain = Object.hasOwn(chains, params.get("chain")) ? params.get("chain") : "4217";
let range = ranges.includes(params.get("range")) ? params.get("range") : "30d";
let metric = "tasksCreated";
let heatDimension = "heatmap";
let eventCursor = null;
let data = null;
let loading = null;
let requestVersion = 0;
const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 6 });
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const dateFull = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const escapeHtml = value => String(value).replace(/[&<>"']/g, value => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[value]);
const integer = value => numberFormat.format(Number(value));
const tokens = value => Number(value) / 1e6;
const unit = () => chains[chain][1];
const shortDate = value => dateFormat.format(new Date(value));
const fullDate = value => dateFull.format(new Date(value)) + " UTC";
const formatTime = value => timeFormat.format(new Date(value));
const label = value => String(value).replaceAll("_", " ").replace(/^./, x => x.toUpperCase());
const color = ["#d9a097", "#efe9e2", "#b0a79d", "#785447", "#874e60", "#5e4c43", "#706458"];
const metrics = {
  tasksCreated: ["Tasks posted", false],
  activeAgents: ["Active agents", false],
  rewardVolume: ["Rewards posted", true],
  paidVolume: ["Rewards paid", true],
};

function taskLink(id, taskChain = chain) {
  return "https://taskmarket.dev/tasks/" + encodeURIComponent(id) + "?chain=" + encodeURIComponent(taskChain);
}

function eachButton(group, current, attribute) {
  document.querySelectorAll(group + " button").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset[attribute] === current));
  });
}

function urlFor(nextView) {
  const url = new URL(nextView === "overview" ? "/" : "/" + nextView, location.origin);
  if (chain !== "4217") url.searchParams.set("chain", chain);
  if (range !== "30d" && nextView !== "posters") url.searchParams.set("range", range);
  return url.pathname + url.search;
}

function syncFilters() {
  eachButton("#networks", chain, "network");
  eachButton("#ranges", range, "range");
  document.querySelectorAll("nav a").forEach(link => { link.href = urlFor(link.dataset.view); });
  document.querySelector("nav [data-view=" + view + "]").setAttribute("aria-current", "page");
}

function dataTable(caption, headers, rows) {
  const body = rows.map(row => "<tr>" + row.map(value => "<td>" + escapeHtml(value) + "</td>").join("") + "</tr>").join("");
  return `<details class="chart-table"><summary>View data table</summary><div class="table-wrap"><table>
    <caption class="visually-hidden">${escapeHtml(caption)}</caption><thead><tr>${headers.map(header =>
      "<th scope=col>" + escapeHtml(header) + "</th>").join("")}</tr></thead><tbody>${body}</tbody></table></div></details>`;
}

function overviewCards(stats) {
  const fields = {
    openTasks: "Open tasks",
    activeAgents7d: "Active agents · 7d",
    activeWorkers7d: "Active workers · 7d",
    registeredWorkers: "Registered workers",
    paidWorkers: "Paid workers · " + chains[chain][0],
    activeWallets: "Active wallets · " + chains[chain][0],
  };
  return `<div class="stats">${Object.entries(fields).map(([key, name]) =>
    `<div class="stat"><span>${name}</span><strong>${integer(stats[key])}</strong></div>`).join("")}</div>`;
}

function graph(series, name, key, bucket) {
  if (!series.length) return "<p>No data in this period.</p>";
  const [, currency] = metrics[key];
  const values = series.map(point => currency ? tokens(point[key]) : Number(point[key]));
  const upper = Math.max(1, ...values);
  const magnitude = 10 ** Math.floor(Math.log10(upper));
  const max = Math.ceil(upper / magnitude * 2) / 2 * magnitude;
  const width = 610, left = 54, right = 592, top = 16, bottom = 191;
  const x = index => left + (right - left) * index / Math.max(1, series.length - 1);
  const y = value => bottom - (bottom - top) * value / max;
  const points = values.map((value, i) => [x(i), y(value)]);
  const path = points.map(([px, py]) => `${px},${py}`).join(" ");
  const area = [`${left},${bottom}`, path, `${x(series.length - 1)},${bottom}`].join(" ");
  const yTicks = [0, .25, .5, .75, 1].map(fraction => {
    const at = y(max * fraction);
    return `<line class="tick" x1="${left}" y1="${at}" x2="${right}" y2="${at}"></line><text x="${left - 9}" y="${at + 4}" text-anchor="end">${compact.format(max * fraction)}</text>`;
  }).join("");
  const indices = [...new Set([0, Math.round((series.length - 1) / 2), series.length - 1])];
  const xTicks = indices.map((index, i) => `<text x="${x(index)}" y="216" text-anchor="${i === 0 ? "start" : i === indices.length - 1 ? "end" : "middle"}">${shortDate(series[index].bucket)}</text>`).join("");
  const dots = points.map(([px, py], i) => `<circle class="chart-dot" cx="${px}" cy="${py}" r="4"><title>${shortDate(series[i].bucket)} · ${integer(values[i])}${currency ? " USD eq." : ""}</title></circle>`).join("");
  return `<svg class="chart" viewBox="0 0 ${width} 225" role="img" aria-label="${name} by ${bucket}"><defs><linearGradient id="chart-fill" x2="0" y2="1"><stop stop-color="#d9a097" stop-opacity=".27"/><stop offset="1" stop-color="#d9a097" stop-opacity="0"/></linearGradient></defs>
    ${yTicks}<polygon points="${area}" fill="url(#chart-fill)"></polygon><polyline class="chart-line" points="${path}"></polyline>${dots}${xTicks}</svg>`;
}

function trend(series, bucket) {
  return `<section class="panel"><h2>Market over time</h2><p class="sub">${bucket === "day" ? "Daily buckets" : "Weekly buckets"} · All networks · UTC</p>
    <div class="segmented chart-switch" role="group" aria-label="Chart metric">${Object.entries(metrics).map(([key, [name]]) =>
      `<button type="button" data-metric="${key}" aria-pressed="${key === metric}">${name}</button>`).join("")}</div>
    <div id="trend-chart">${trendContents(series, bucket)}</div></section>`;
}

function trendContents(series, bucket) {
  const [name, currency] = metrics[metric];
  return graph(series, name, metric, bucket) + dataTable(name, ["Date (UTC)", name + (currency ? " · USD eq." : "")], series.map(point => [
    point.bucket, integer(currency ? tokens(point[metric]) : point[metric]),
  ]));
}

function flow(series) {
  const sum = key => series.reduce((total, point) => total + Number(point[key]), 0);
  const stages = [
    ["01", "Tasks posted", "Work enters the market", integer(sum("tasksCreated"))],
    ["02", "Rewards posted", "Attached to newly posted work", integer(tokens(sum("rewardVolume")))],
    ["03", "Rewards paid", "Released to selected workers", integer(tokens(sum("paidVolume")))],
  ];
  return `<section class="panel"><h2>The path to payment</h2><p class="sub">All networks · Rewards at USD face value</p>
    <div class="flow">${stages.map(([index, title, description, value]) =>
      `<div class="stage"><i aria-hidden="true">${index}</i><span>${title}<small>${description}</small></span><strong>${value}</strong></div>`).join("")}</div>
    <p class="sub">A reward paid this period may come from an earlier posting.</p></section>`;
}

function breakdown(title, entries, key) {
  const ordered = [...entries].sort((a, b) => b.count - a.count);
  const total = ordered.reduce((sum, item) => sum + item.count, 0);
  return `<section class="panel"><h2>${title}</h2><p class="sub">${integer(total)} records in the API breakdown</p>
    <div class="split-bar" aria-hidden="true">${ordered.map((item, i) =>
      `<b style="width:${total ? item.count / total * 100 : 0}%;background:${color[i % color.length]}"></b>`).join("")}</div>
    <div class="rows">${ordered.map((item, i) => `<div class="row"><span><i class="swatch" style="background:${color[i % color.length]}"></i>
      ${escapeHtml(label(item[key]))}</span><b>${integer(item.count)}</b></div>`).join("")}</div></section>`;
}

function attention(tasks) {
  if (!tasks.length) return "";
  const ranked = [...tasks].sort((a, b) => b.submissions - a.submissions)
    .filter(task => task.submissions > 0).slice(0, 6);
  const highest = ranked[0]?.submissions || 0;
  return `<section class="panel full"><h2>Where submissions gather</h2>
    <p class="sub">Most submissions among the latest ${tasks.length} public tasks on ${chains[chain][0]}. Rewards are in ${unit()}.</p>
    ${ranked.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Task</th><th scope="col">Mode</th><th scope="col">Submissions</th><th scope="col">Reward</th></tr></thead>
    <tbody>${ranked.map(task => `<tr><td><a href="${taskLink(task.id)}">${escapeHtml(task.title)}</a></td>
    <td>${escapeHtml(label(task.mode))}</td><td><span class="mini-bar" style="--bar:${task.submissions / highest * 100}%"></span>${integer(task.submissions)}</td>
    <td>${integer(tokens(task.reward))}</td></tr>`).join("")}</tbody></table></div>` : "<p>No submissions among these tasks yet.</p>"}</section>`;
}

function overviewPanel() {
  return overviewCards(data.stats) +
    `<div class="grid">${trend(data.series, data.bucket)}${flow(data.series)}</div>
    <div class="grid equal">${breakdown("Tasks by mode", data.breakdowns.mode, "mode")}
    ${breakdown("Tasks by status", data.breakdowns.status, "status")}</div>` + attention(data.recent);
}

const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function heatmapGrid(heatmap) {
  const byHour = heatDimension === "heatmap";
  if (!heatmap.rowKeys.length || !heatmap.colKeys.length) return "<p>No activity in this period.</p>";
  const columns = heatmap.colKeys;
  const cellCounts = new Map(heatmap.cells.map(cell => [cell.row + "/" + cell.col, cell.count]));
  const formatRow = row => byHour ? weekDays[Number(row)] ?? row : label(row);
  const formatCol = col => byHour ? col.padStart(2, "0") + ":00" : shortDate(col);
  const stride = Math.max(1, Math.ceil(columns.length / 8));
  const columnHeaders = columns.map((col, index) => `<span>${index % stride === 0 ? escapeHtml(byHour ? col.padStart(2, "0") : formatCol(col)) : ""}</span>`).join("");
  const rows = heatmap.rowKeys.map(row => `<span>${escapeHtml(formatRow(row))}</span>` + columns.map(col => {
    const count = cellCounts.get(row + "/" + col) || 0;
    const value = count ? 13 + Math.round(87 * Math.sqrt(count / (heatmap.maxCount || 1))) : 0;
    const title = escapeHtml(`${formatRow(row)} · ${formatCol(col)} UTC · ${integer(count)} events`);
    return `<i style="--level:${value}" title="${title}"></i>`;
  }).join("")).join("");
  const first = byHour ? "Day" : "Mode";
  return `<div class="heat-scroll" aria-hidden="true"><div class="heat" style="grid-template-columns:4.5rem repeat(${columns.length},minmax(16px,1fr))">
    <span></span>${columnHeaders}${rows}</div></div>
    <div class="heat-legend micro" aria-hidden="true"><span>0</span><i></i><i></i><i></i><i></i><span>${integer(heatmap.maxCount)} events</span></div>
    ${dataTable("Activity heatmap", [first, byHour ? "Hour (UTC)" : "Date (UTC)", "Events"],
      heatmap.rowKeys.flatMap(row => columns.map(col => [formatRow(row), formatCol(col), integer(cellCounts.get(row + "/" + col) || 0)]))) }`;
}

function feedItems(items) {
  return items.map(event => `<li>
    <a class="event-title" href="${taskLink(event.taskId, event.chainId || chain)}">${escapeHtml(event.taskTitle || "Untitled task")}</a>
    <time datetime="${escapeHtml(event.timestamp)}" title="${escapeHtml(fullDate(event.timestamp))}">${formatTime(event.timestamp)}</time>
    <small>${escapeHtml(label(event.type))}${event.actorType ? " · " + escapeHtml(label(event.actorType)) : ""}${chains[event.chainId] ? " · " + chains[event.chainId][0] : ""}</small>
    ${event.amount != null ? `<b>${integer(tokens(event.amount))} ${chains[event.chainId]?.[1] || "USD eq."}</b>` : ""}</li>`).join("");
}

function activityPanel() {
  eventCursor = data.feed.nextCursor;
  return `<div class="grid"><section class="panel"><h2>When work happens</h2>
    <p class="sub">Public event counts · All networks · UTC</p>
    <div class="segmented chart-switch" role="group" aria-label="Heatmap dimension">
    <button data-heat="heatmap" type="button" aria-pressed="${heatDimension === "heatmap"}">Hour of week</button>
    <button data-heat="byMode" type="button" aria-pressed="${heatDimension === "byMode"}">Task mode</button></div>
    <div id="heat-chart">${heatmapGrid(data[heatDimension])}</div></section>
    <section class="panel"><h2>Activity feed</h2><p class="sub">Latest public events · All networks · UTC</p>
    <ul id="feed-items" class="event-list">${data.feed.items.length ? feedItems(data.feed.items) : "<li>No public events found.</li>"}</ul>
    <button class="button" id="feed-more" type="button" ${eventCursor ? "" : "hidden"}>Load older events</button></section></div>`;
}

function postersPanel() {
  const weeks = data.weeks;
  const max = Math.max(1, ...weeks.map(week => week.posters));
  const last = weeks.at(-1);
  const complete = weeks.slice(0, -1).filter(week => week.complete);
  const previous = complete.at(-1);
  const share = previous?.tasks ? numberFormat.format(Math.round(previous.topPosted / previous.tasks * 1000) / 10) + "%" : null;
  return `<div class="grid"><section class="panel"><h2>Distinct posters per week</h2>
    <p class="sub">One count per requester address · UTC weeks</p>
    <div class="poster-bars">${weeks.map((item, i) => `<div class="poster-row"><span>${shortDate(item.week)}</span>
      <div aria-hidden="true"><i style="--bar:${item.posters / max * 100}%"></i></div>
      <strong>${item.complete ? "" : "≥ "}${integer(item.posters)}</strong>
      ${i === weeks.length - 1 ? "<small>In progress</small>" : item.complete ? "" : "<small>Partial data</small>"}</div>`).join("")}</div>
    ${dataTable("Distinct task posters", ["Week starting", "Poster wallets", "Tasks counted", "Most from one wallet", "Coverage"], weeks.map((item, i) => [
      item.week, (item.complete ? "" : "≥ ") + integer(item.posters), integer(item.tasks), integer(item.topPosted), i === weeks.length - 1 ? (item.complete ? "In progress" : "In progress, partial") : item.complete ? "Complete" : "Partial",
    ]))}</section>
    <section class="panel"><h2>Who posts the work?</h2>
    <p class="sub">The last complete UTC week</p>
    ${previous ? `<div class="insight"><strong>${integer(previous.posters)}</strong><span>different wallets posted ${integer(previous.tasks)} tasks.</span></div>
    ${share ? `<p>The busiest wallet posted <strong>${escapeHtml(share)}</strong> of the week’s public tasks.</p>` : ""}` : "<p>A full week of coverage is unavailable.</p>"}
    <p class="sub">${last.complete ? "" : "At least "}${integer(last.posters)} posters so far this week.</p></section></div>`;
}

function changeFilters() {
  syncFilters();
  history.replaceState({}, "", urlFor(view));
  data = null;
  dashboard.setAttribute("aria-busy", "true");
  dashboard.innerHTML = '<div class="loading-grid" aria-hidden="true"><i></i><i></i><i></i></div>';
  snapshot.classList.remove("ready");
  snapshot.textContent = "Fetching public market data…";
  load();
}

async function requestData(cursor) {
  const query = new URLSearchParams({ chain, range });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/data/${view}?${query}`, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error("Market data unavailable");
  return response.json();
}

function render() {
  dashboard.innerHTML = ({ overview: overviewPanel, activity: activityPanel, posters: postersPanel })[view]();
  dashboard.setAttribute("aria-busy", "false");
  snapshot.classList.toggle("ready", !data.stale);
  snapshot.textContent = (data.stale ? "Previous snapshot · " : "Data as of ") + fullDate(data.asOf);
}

async function load(refresh = false) {
  if (refresh && loading) return;
  const version = ++requestVersion;
  const request = requestData();
  loading = request;
  try {
    const next = await request;
    if (version !== requestVersion) return;
    if (refresh && data?.asOf === next.asOf && data?.stale === next.stale) return;
    data = next;
    render();
  } catch {
    if (version !== requestVersion) return;
    dashboard.setAttribute("aria-busy", "false");
    snapshot.classList.remove("ready");
    if (data) {
      snapshot.textContent = "Refresh unavailable · data as of " + fullDate(data.asOf);
      return;
    }
    snapshot.textContent = "Public market data is temporarily unavailable.";
    dashboard.innerHTML = '<p><button class="button" type="button" id="retry">Try again</button></p>';
  } finally {
    if (version === requestVersion) loading = null;
  }
}

async function loadOlder(button) {
  if (!eventCursor) return;
  const version = requestVersion;
  button.disabled = true;
  button.textContent = "Loading…";
  try {
    const { feed } = await requestData(eventCursor);
    if (version !== requestVersion) return;
    document.querySelector("#feed-items").insertAdjacentHTML("beforeend", feedItems(feed.items));
    eventCursor = feed.nextCursor;
    button.hidden = !eventCursor;
    button.textContent = "Load older events";
  } catch {
    button.textContent = "Couldn’t load events. Retry";
  } finally {
    button.disabled = false;
  }
}

document.querySelector("#networks").addEventListener("click", event => {
  const next = event.target.dataset.network;
  if (next && next !== chain) { chain = next; changeFilters(); }
});
document.querySelector("#ranges").addEventListener("click", event => {
  const next = event.target.dataset.range;
  if (next && next !== range) { range = next; changeFilters(); }
});
document.querySelector("#share").addEventListener("click", async event => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(location.origin + urlFor(view));
    button.textContent = "Copied";
  } catch {
    button.textContent = "Use address bar";
  }
  setTimeout(() => { button.textContent = "Copy link"; }, 2400);
});
dashboard.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "retry") load();
  if (button.id === "feed-more") loadOlder(button);
  if (button.dataset.metric) {
    metric = button.dataset.metric;
    eachButton(".chart-switch", metric, "metric");
    document.querySelector("#trend-chart").innerHTML = trendContents(data.series, data.bucket);
  }
  if (button.dataset.heat) {
    heatDimension = button.dataset.heat;
    eachButton(".chart-switch", heatDimension, "heat");
    document.querySelector("#heat-chart").innerHTML = heatmapGrid(data[heatDimension]);
  }
});

if (heading[view]) {
  document.querySelector("#headline").innerHTML = heading[view][0];
  document.querySelector("#lede").textContent = heading[view][1];
}
document.querySelector("#range-control").hidden = view === "posters";
document.querySelector("#network-control").hidden = view === "activity";
syncFilters();
load();
setInterval(() => { if (!document.hidden) load(true); }, 300_000);

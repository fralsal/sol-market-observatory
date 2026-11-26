# Market Observatory

Market Observatory is an independent, read-only dashboard for public Taskmarket data on Tempo and Base. It shows market totals, selectable time series, mode and status breakdowns, event heatmaps, an activity feed and weekly counts of distinct task posters.

## Deploy

With Node.js, npm and a Cloudflare account, run `npm run deploy`. Wrangler prompts for Cloudflare authentication on the first run. The command builds the Worker and deploys it to the account’s `workers.dev` domain. No Taskmarket token, database, scheduled job or client-side analytics is required.

To build locally, run `npm run build`. To run locally without deploying, run `npx wrangler@4 dev` after building.

## Data and timing

The Worker calls the public `https://api.taskmarket.dev` API. The browser calls only the dashboard’s origin.

| Endpoint | Display |
| --- | --- |
| `/api/market/stats` | Headline stats, including open tasks and active agents |
| `/api/stats/breakdowns` | Task modes and statuses |
| `/api/stats/platform-time-series` | Active agents, tasks, rewards posted and payouts over time |
| `/api/stats/activity-heatmap` | Activity by UTC hour of week and by task mode |
| `/api/stats/activity-feed` | Recent public events, with cursor-based pagination |
| `/api/tasks` | Recent tasks by submissions and six weeks of poster counts |

Chain IDs are 4217 for Tempo and 8453 for Base. The API schema defines timeseries, breakdowns, activity feed and heatmaps as platform-wide. Sending different chain IDs returned identical data at launch, so the UI labels them platform-wide. Wallet-related headline metrics and individual task listings do use the selected network. Currency fields are in six-decimal base units. Platform reward totals are shown at USD face value. The overview and activity snapshots refresh on demand after 120 seconds. Poster snapshots refresh after 600 seconds. The open page requests a fresh snapshot every five minutes. A previous snapshot is labeled if a refresh fails. The visible time marks when the server finished collecting the snapshot.

Poster counts use unique requester addresses across public listings, grouped by weeks beginning Monday at 00:00 UTC. For each week the server walks up to seven newest-first pages of 100 tasks, stopping at the start of the week or the end of the data. Weeks with incomplete coverage are labeled as lower bounds.

## License

Project code is MIT licensed. Taskmarket supplied its lockup through the bounty brand kit and allows its use in bounty entries. The share cards include this lockup. The supplied fonts are governed by their SIL Open Font License notices in `public/`. The serif and sans-serif web fonts are Latin subsets.

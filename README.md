# Frostly · فروستلي

_TikTok & Instagram downloader, profile viewer, story viewer & analytics — by Wahm (@iwahm). Suggested domain: **frostly.store**._

Arabic-first SaaS for **public** TikTok & Instagram account insights: profile viewer, recent posts, watermark-free downloads, public story viewer, analytics, compare, watchlist and Pro plans.

Built with **Next.js 14 (App Router) + TypeScript + Tailwind**, deployed as a single Render web service.

## Features
- Platform toggle (TikTok | Instagram), username or URL search
- SSR profile pages with OG images, JSON-LD (ProfilePage, VideoObject, FAQ, Breadcrumbs), sitemap & robots
- Post detail + no-watermark video / image / audio downloads (streamed through an allow-listed media proxy)
- Story viewer (Instagram public stories need `IG_SESSIONID`; TikTok stories use the tikwm.com public fallback when reachable)
- Followers/following: per-account privacy gate (public / hidden / private). TikTok lists load via the official TikTok Research API when `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` are set; otherwise counts + "open on TikTok". Instagram lists are login-only.
- Instagram: public link-preview fallback for profile name/avatar/counts and single posts when the web API is blocked
- Analytics: engagement rate, averages, posting frequency, best day/hour, top hashtags, earnings estimate, Frost score
- Pro: batch download, compare accounts, watchlist, CSV export, advanced analytics; Business: API keys
- Auth: email/password + JWT httpOnly cookie, magic-link stub; per-plan daily quotas; burst rate limiting
- Billing: mock mode by default; Stripe Checkout + signed webhook when keys are set
- Admin dashboard, AR/EN i18n with RTL, icy glassmorphism design with light ("sugar") and dark ("frost") themes

## Architecture
```
src/
  app/                 routes (pages + /api route handlers)
  components/          UI library (ui, layout, profile, post, analytics, download, compare, watchlist, pricing, auth, seo, content)
  lib/
    platforms/         adapters: tiktok/, instagram/ (pure parsers + I/O), demo.ts, index.ts (service w/ cache + fallback)
    server/            http, cache (LRU + stale-if-error), rateLimit, db (JSON store + repositories), auth, quota, media proxy
    i18n/              ar.ts / en.ts dictionaries
    seo/               metadata + JSON-LD builders
    content/           blog, FAQ, featured accounts, static pages, SEO tool pages
    analytics.ts       pure analytics + CSV
    plans.ts           plan catalogue & feature gates (single source of truth)
tests/                 node:test unit tests for parsers/analytics
```

### Data sources (public only)
| Platform | Data | Source |
|---|---|---|
| TikTok | Profile | `tiktok.com/@user` SSR JSON (via `RELAY_URL` when set) |
| TikTok | Recent posts | `tiktok.com/embed/@user` + per-video SSR JSON for stats |
| TikTok | Downloads | video page `playAddr` streamed with the page cookies; tikwm.com `/api/?url=` as a last-resort fallback |
| TikTok | Stories | tikwm.com `/api/user/story` via `RELAY_URL` when set (empty, `tikwm_blocked`, or honest `tikwm_quota` when the free daily limit is hit; never invented) |
| TikTok | Profile fallback | tikwm.com `/api/user/info` when the official page is blocked or thin; countik.com language + video-id hints. Country from videos only (not invented for zero-post accounts) |
| Instagram | Profile + 12 posts | `web_profile_info` public endpoint |
| Instagram | Single post | `/p/{code}/embed/captioned/` |
| Instagram | Stories | `reels_media` (requires `IG_SESSIONID` of a server-owned account; public accounts only) |
| Instagram | Post comments | private comments endpoint (requires a valid server-side `IG_SESSIONID`; unofficial and may be blocked) |

Instagram heavily rate-limits datacenter IPs. When blocked, `DEMO_MODE=auto` serves clearly-labelled demo data so the UI stays usable. Post comments require a valid server-side `IG_SESSIONID`; this is an unofficial endpoint, not Meta's supported public-comments API, and may be blocked or change. For production reliability set `IG_SESSIONID` and/or `SCRAPER_PROXY`.

Private accounts, DMs, and follower lists are **never** bypassed.

## Env vars
See `.env.example`. Key ones: `JWT_SECRET`, `NEXT_PUBLIC_SITE_URL`, `ADMIN_EMAILS`, `IG_SESSIONID`, `STRIPE_*`, `DEMO_MODE`, `DATA_DIR`.

## Dev
```bash
npm install
npm run dev
npm test
```

## Deploy
Render Blueprint: `render.yaml`. Note: free instances have an ephemeral disk; attach a disk or migrate the repositories in `lib/server/db.ts` to Postgres for durable accounts.

## Code protection
- Code is split into many small modules (UI primitives, i18n sections, blog articles, platform parsers/adapters, connections providers).
- `productionBrowserSourceMaps: false` — no `.map` files ship.
- Client app chunks are obfuscated in production with `webpack-obfuscator` (string arrays, renamed identifiers). Disable with `OBFUSCATE=0`.
- Server logic (scrapers, auth, DB, quotas) is marked `server-only` and never ships to the browser.

## Extra env vars
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` — TikTok Research API credentials (optional) for public follower/following lists.

## Instagram reliability
Instagram answers shared datacenter IPs (like Render's free tier) with HTTP 429 / login redirects.
The adapter tries: session web API → session app API → anonymous → public link preview (rotating unfurl agents),
and serves the last good copy for 24h when blocked. Set `SCRAPER_PROXY=http://user:pass@host:port`
(residential or home-router proxy) to route Instagram, TikTok, and tikwm.com/countik.com fallbacks through a clean IP. For TikTok/tikwm/countik only, `RELAY_URL` (a Cloudflare Worker such as `https://name.workers.dev`) is a lighter alternative to a residential proxy. `/api/health?ig=1` shows the last
lookup's per-step HTTP statuses (no cookie values).

## Followers lists (method chain)
TikTok: official Research API → TikTok web list endpoint (plain request) → mobile web → `TIKTOK_SESSIONID` session.
No request-signature (X-Bogus/msToken) generation, ever. The followers tab shows the latest 5 when any method returns data,
otherwise five locked slots and the exact methods tried with their outcome.
Instagram: server session `friendships/{id}/followers` for public accounts.

## TikTok account location
Country = `locationCreated` of the latest public videos (where they were posted), plus last tagged place and account language.

## Admin panel

A secret control panel lives at `/<ADMIN_PATH>/` (random slug in Render env; every other admin-like path returns 404).
Login is password-only (bcrypt hash in `ADMIN_PASSWORD_HASH`, 5 attempts / 15 min / IP, 12 h signed httpOnly cookie scoped to the panel path).
From the panel you can edit the site name and all home/footer copy, the announcement banner, SEO (titles, description, keywords,
Google/Bing verification, robots on/off), favicon / OG / hero images, `SCRAPER_PROXY` and `RELAY_URL` (each with a live test), Instagram/TikTok sessions and keys,
feature toggles, Pro prices, DEMO_MODE, accent colours and default theme, plus a status page with "clear cache".

Persistence: settings are committed to a **private GitHub repo** (`ADMIN_DATA_REPO`) through a write-only deploy key scoped to that repo
(`ADMIN_DATA_SSH_KEY`). Pushes there never redeploy the app, survive Render free-tier restarts/redeploys, and are refreshed every ~minute.
Secrets edited in the panel are stored AES-256-GCM encrypted (key derived from `JWT_SECRET`) in `secrets.enc.json` and applied onto `process.env` at runtime.

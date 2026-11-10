# The news tile and widget show the latest headlines of NOS's RSS feeds, read by HomeyDash

The news tile shows the latest headlines of a NOS feed (general, domestic, foreign, economy, sport or tech), and the lock
screen has a news widget with the newest one. HomeyDash reads each feed in use every 10 minutes
(`feeds.nos.nl/...`) and pushes every source's stories over the realtime connection as `News`. Displays never call NOS.
A tile names its feed in `settings.source`, a widget in `source`; without one they show the general feed (`nos`).

## Considered Options

- **A news API (NewsAPI, GNews).** Rejected: they need a key, and so an account under Accounts, and their free tiers
  are limited or delayed. NOS's RSS is free, keyless and what people in the Netherlands read.
- **Any feed URL typed in Management.** Rejected for now: it makes HomeyDash fetch whatever address it is given. A fixed
  list of sources keeps what it calls known; another publisher is one line in `NewsSource.All` (and `NEWS_SOURCES`).
- **Rotating headlines on the tile.** Left out: the tile shows the newest ones and a screen is for glancing.

## Consequences

- No account to set up. `News:Fake=true` runs against made-up stories, for development and tests.
- When NOS can't be reached the last stories stay and the tile is marked unavailable; HomeyDash tries again every 2 minutes.
- Sources are mirrored in `apps/api/News/News.cs` and `libs/api-client/src/lib/news.ts`; assistants can place news tiles and
  widgets over MCP ([ADR-0006](0006-mcp-server-for-assistants.md)).

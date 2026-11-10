# The news tile and widget show the latest headlines of NOS's RSS feeds, read by HomeyDash

The news tile shows the latest headlines of a NOS feed (general, domestic, foreign, economy, sport or tech), and the lock
screen has a news widget with the newest one. HomeyDash reads each feed in use every 10 minutes
(`feeds.nos.nl/...`) and pushes every source's stories over the realtime connection as `News`. Displays never call NOS.
A tile names its feed in `settings.source`, a widget in `source`; without one they show the general feed (`nos`).

A press on the tile opens its feed over the whole screen, newest story large, and a press on a story shows it as a reader view in
a frame, with a way back. NOS sends `frame-ancestors 'self'`, so its own pages cannot be framed: HomeyDash reads the article out
of the page's data when a story is opened (`GET /api/news/article`, only for a link in a feed in use, only on nos.nl), shows its
text and pictures in a page of its own and keeps it for 30 minutes. The frame is sandboxed and the page carries a policy that
allows only its own style and one script, which tells the screen the story is being read so the view does not close on it.

The detail view is all of NOS's news: tabs for Live, Video's and every feed (general, politics, domestic, foreign, economy, royal
house, culture and media, remarkable, sport, tech; NOS has no regional feed). A tab that is not the tile's own feed is read when
opened (`GET /api/news/feed`, kept 5 minutes). Livestreams and videos have no RSS: HomeyDash reads NOS's live page and video list
from the data the pages carry (`/api/news/live`, `/api/news/videos`, `/api/news/video/{id}`) and hands the screen an HLS stream
from `resolver.streaming.api.nos.nl`, which it plays itself with hls.js (the screen's own player where that cannot run). A
livestream that has not started has no stream yet and cannot be opened. An open video or livestream has a **Play on AirPlay** button:
the same Apple TVs and the same `AirPlayNow` as Plex ([ADR-0012](0012-airplay-in-dotnet.md)), with
`source: nos` on the playback so Plex's tiles ignore it and nothing is reported to a Plex server. The Apple TV fetches NOS's HLS stream
itself (`NosPlayback`).

## Considered Options

- **A news API (NewsAPI, GNews).** Rejected: they need a key, and so an account under Accounts, and their free tiers
  are limited or delayed. NOS's RSS is free, keyless and what people in the Netherlands read.
- **Any feed URL typed in Management.** Rejected for now: it makes HomeyDash fetch whatever address it is given. A fixed
  list of sources keeps what it calls known; another publisher is one line in `NewsSource.All` (and `NEWS_SOURCES`).
- **Proxying nos.nl with its frame headers removed.** Rejected: the page's scripts, consent banner and pictures break, and it
  depends on how NOS builds its site rather than on its feeds.
- **Rotating headlines on the tile.** Left out: the tile shows the newest ones and a screen is for glancing.

## Consequences

- Pictures in the overview and the reader view load from NOS's image host (`images.cdn.nos.nl`) by the display itself; text is read by HomeyDash.
- No account to set up. `News:Fake=true` runs against made-up stories, for development and tests.
- When NOS can't be reached the last stories stay and the tile is marked unavailable; HomeyDash tries again every 2 minutes.
- Sources are mirrored in `apps/api/News/News.cs` and `libs/api-client/src/lib/news.ts`; assistants can place news tiles and
  widgets over MCP ([ADR-0006](0006-mcp-server-for-assistants.md)).

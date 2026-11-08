# The traffic tile shows TomTom's live travel time by car on one route, through HomeyDash

The traffic tile shows how long a route takes by car now, and how much longer than usual: the minutes, the delay (which
colours the tile), and by size the distance, the arrival time when leaving now, and the usual time. The same route can
show on a display's **Lock screen** as a traffic widget. HomeyDash asks [TomTom](https://developer.tomtom.com)'s Routing
API (`calculateRoute` with `traffic=true`, `computeTravelTimeFor=all`): `travelTimeInSeconds` is the time with the traffic
now, `historicTrafficTravelTimeInSeconds` the usual time at this hour (the free-flow time when TomTom has no history), and
the delay is the first over the second, never below zero.

TomTom needs an API key, so it is an account kind under Accounts ([ADR-0007](0007-accounts-set-up-in-management.md)): a
name and a key, checked with TomTom's geocoder when added or changed and never sent back. A tile names its account in
`settings.account` (the oldest when it names none); a lock screen widget in `account`. The key never reaches a display:
displays get results over the realtime connection as `Traffic`, and Management finds places through
`/api/traffic/places`, which searches with the account's key.

A route is `{ name, origin, destination }`, each place a name with latitude and longitude, found by name in Management with
TomTom's Search API (`/search/2/search`, typeahead), picking from matches with region and country, like the weather tile's
place ([ADR-0013](0013-weather-from-open-meteo-and-buienradar.md)). A tile keeps it in `settings.route`, a widget in
`route`. A traffic tile points at nothing in Homey (`settings.target` is null), so it is never missing.

`TrafficWatcher` looks at every dashboard's draft and published version (logic tiles' held tiles included) and every
display's lock widgets every 30 seconds and asks TomTom for each route in use once every 5 minutes, retrying after 2 after
a failure. Routes whose places are the same to three decimals (about 100 m) share one result, however many tiles and widgets
show them, and one that nothing uses any more is dropped. Saving a dashboard or lock screen wakes it, so a new route shows
at once.

## Considered Options

- **Google Maps or Here routing.** Rejected: Google bills per request with no free tier worth the name; Here is comparable
  to TomTom, but TomTom's free tier (2,500 requests a day) is plenty and its answer carries the usual time directly.
- **Open-source routing (OSRM, Valhalla) without traffic.** Rejected: no live traffic is the point.
- **The delay over the free-flow time (`trafficDelayInSeconds`).** Rejected: a route that is always slow at 8:00 would
  always show a delay; the delay over the usual time says when to leave earlier than normal.
- **Typing coordinates, or an address the API looks up each time.** Rejected for the reasons in ADR-0013: choosing from
  the search's matches settles it once and keeps the coordinates.
- **Displays calling TomTom themselves.** Rejected: that would put the key in every display.

## Consequences

- One route asked every 5 minutes is 288 requests a day, so about eight different routes fit TomTom's free tier. HomeyDash
  doesn't count them; TomTom answering 429 shows as `TomTom's limit for this key is reached`, and the last result stays.
- Without a TomTom account the tile says `Set up TomTom in Management`; with an account TomTom refuses, or when it can't be
  reached, the last result stays, dimmed, with when it is from. A lock screen widget with no result yet is left out.
- Removing an account leaves the tiles and widgets naming it without traffic until they are given another; a tile that names
  none uses the oldest.
- `Traffic:Fake=true` runs against a made-up TomTom with one account that can't be changed, a few places, and 25 minutes
  where 18 is usual (a route from a place named `Jam` is 45, one from `Clear` has no delay), for development and tests.
- Assistants can place traffic tiles and widgets over MCP ([ADR-0006](0006-mcp-server-for-assistants.md)) by giving the
  route; places are found in Management.

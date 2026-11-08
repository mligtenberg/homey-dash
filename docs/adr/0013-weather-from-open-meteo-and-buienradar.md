# The weather tile shows Open-Meteo's forecast and Buienradar's rain where Homey is, or at a place of its own, through HomeyDash

The weather tile shows the weather where a Homey is, or at a town chosen for the tile instead: now, the coming hours and
days, and the rain of the next two hours.
Homey's own weather ([Lock screen widget](../../CONTEXT.md)) only says what it is now, so HomeyDash asks two services
itself: [Open-Meteo](https://open-meteo.com) for the forecast every 15 minutes, and
[Buienradar](https://www.buienradar.nl) for the rain in five-minute steps every 5. It asks for the location set in
Homey's own settings (`geolocation/option/location`, which needs the geolocation scope), once a session. A tile can
override it with a town found by name in Management through Open-Meteo's geocoding (`/api/weather/places`); the town's
name and coordinates are kept in the tile's settings. HomeyDash watches every place that a dashboard's draft or published
version has, and pushes each Homey's and each place's `Forecast` over the realtime connection as `Forecasts`. Displays
never call any of these services.

## Considered Options

- **Homey's own weather.** Kept for the lock screen, but it has no forecast, so it can't fill more than a small tile.
- **OpenWeatherMap or WeatherAPI.** Rejected: both need an API key, and so an account under Accounts, for nothing
  Open-Meteo lacks. Open-Meteo needs no key and draws on KNMI's and DWD's models, which are sharp for the Netherlands.
- **met.no.** Also free and keyless, but asks for a contact address in every request and stricter caching. Open-Meteo is
  simpler for the same forecast.
- **Rain from Open-Meteo's 15-minute data.** Rejected for the next two hours: Buienradar's nowcast follows the radar and
  is what people in the Netherlands look at. It only covers the Netherlands and Belgium; elsewhere the rain is left out.
- **Typing coordinates, or a place name the API looks up each time.** Rejected: people know towns, not coordinates, and
  a name alone is ambiguous (Amersfoort is also in South Africa). Choosing from the search's matches, with region and
  country, settles it once and keeps the coordinates.

## Consequences

- No account to set up: a weather tile works as soon as a Homey with a location is. Without one it says
  `Set a location in Homey`; with a Homey whose API key lacks the geolocation scope, the same.
- A weather tile for where its Homey is names it in `settings.account` like a Homey tile, with the target
  `weather:here`; it is missing only once that account is removed. One with a place of its own has the target
  `weather:place` and `settings.place` (`name`, `latitude`, `longitude`), names no account and is never missing. Tiles at
  the same place, to two decimals, share one forecast; a place no tile has any more is dropped.
- Both services are free for non-commercial use: a home asks Open-Meteo about 100 times a day per Homey, far below its
  limit. Buienradar's endpoint is not a documented API and may change; the tile then shows the forecast without rain.
- When Open-Meteo can't be reached the last forecast stays and the status says so; HomeyDash tries again every 2 minutes.
- `Weather:Fake=true` runs against a made-up grey day with a shower coming, for development and tests.
- Assistants can place weather tiles over MCP ([ADR-0006](0006-mcp-server-for-assistants.md)); `list_targets` with type
  `weather` gives one per Homey and one for a place of its own.

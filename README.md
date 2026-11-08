# HomeyDash

A configurable smart-home control surface for a Homey Pro, shown on screens placed around the home.

- Domain language: [CONTEXT.md](CONTEXT.md)
- Decisions: [docs/adr](docs/adr)
- Design system: [docs/design-system](docs/design-system/README.md)

## Projects

| Project | What it is |
| --- | --- |
| `apps/api` | .NET backend. The only client of Homey; serves both apps' data. |
| `apps/display` | Angular app shown on every display. |
| `apps/management` | Angular app where dashboards are built and displays assigned. |
| `libs/design-system` | Tokens and `hd-*` component CSS, loaded by both apps. |
| `libs/layout` | Tile sizes, cell size and grid rules. |
| `libs/tiles` | Module registry: the tile kinds and what each supports. |
| `libs/api-client` | Typed contracts and clients for the API. |

## Connecting to Homey

The API talks to a Homey Pro over its local API. Create an API key in the Homey web app
(Settings → API keys), then open Management → Accounts and enter the Homey's address and the key. HomeyDash keeps
them in its database and never sends the key back to a browser.

Prefer the Homey's `.local` name over its IP address: the name keeps working when the router gives the Homey a
new address.

Until Homey is set up, displays show connection lost. To run against a built-in fake Homey with sample devices,
flows and moods instead, set `Homey:Fake=true` (`npx nx serve api -c simulator` does).

## Photos from Immich

Photo tiles show photo sets from your [Immich](https://immich.app) server. A photo set follows an album, synced every
15 minutes, or draws photos at random by rules: who should and shouldn't be in them, what they show (such as
"landscape"), how many, and how often to draw again. HomeyDash fetches each photo from Immich as a display shows it,
so displays never need to reach Immich themselves.

1. In Immich, under Account Settings → API Keys, make a key with at least the `album.read`, `asset.read`,
   `asset.view`, `face.read` and `person.read` permissions. Name people in Immich to use them in rules.
2. In Management → Accounts, enter Immich's address (such as `192.168.1.20:2283`) and the key. HomeyDash checks both
   with Immich, keeps them in its database and never sends the key back to a browser.
3. Under Photo sets, add a photo set and choose its album, or its rules.

`Immich:Fake=true` runs against a fake Immich with two sample albums and three people (`npx nx serve api -c simulator` sets it).

## Plex

Plex tiles show what plays on your Plex players, with play/pause and skip buttons, and what was newly added to your
libraries. In Management → Accounts, press **Sign in with Plex** and approve HomeyDash on Plex's page; with several
servers, choose one there. The buttons only work on players that take remote control: Plex's own apps with
**Advertise as player** turned on.

`Plex:Fake=true` runs against a fake Plex with a movie playing and an episode paused (`npx nx serve api -c simulator`
sets it).

### Play on Apple TV (AirPlay)

A movie or episode opened in the recently-added screen can play on an Apple TV with **Play on AirPlay** (see
[ADR-0012](docs/adr/0012-airplay-in-dotnet.md)). HomeyDash speaks AirPlay itself, with the `libs/airplay` library, so
there is nothing else to run. It finds Apple TVs with multicast DNS, which reaches your network from a container only with
host networking (Linux): give the container `network_mode: host`. Management → Accounts → AirPlay lists the Apple TVs it
found and pairs one that asks for a PIN; pairings are kept in `airplay-credentials.json` next to the database
(`AirPlay:CredentialsPath` moves it), and `AirPlay:Enabled=false` switches AirPlay off.

`AirPlay:Fake=true` runs against two made-up Apple TVs.


## Weather

The weather tile shows the weather where your Homey is, with the coming hours and days, and in the Netherlands and Belgium
the rain of the next two hours. There is nothing to set up: HomeyDash reads the location set in Homey (its API key needs
the geolocation scope), or a tile can be given a town of its own under Place in the editor. It asks [Open-Meteo](https://open-meteo.com) for the forecast and
[Buienradar](https://www.buienradar.nl) for the rain (see [ADR-0013](docs/adr/0013-weather-from-open-meteo-and-buienradar.md)).
`Weather:Fake=true` runs against a made-up forecast (`npx nx serve api -c simulator` sets it).
## Energy

The energy tile shows Homey's own energy report: the grid power now (import or export), solar production, the home's
consumption, today's totals and the day by the hour. Create the Homey API key with the `homey.energy.readonly` scope; without
it, or on a Homey with no energy, the tile says it is unavailable (see [ADR-0014](docs/adr/0014-energy-from-homeys-own-report.md)).

## Brightness

Displays measure how much light falls on them, in lux, once a minute, for rules on the **Brightness** signal (see
[ADR-0011](docs/adr/0011-displays-measure-brightness-with-the-camera.md)). Chrome reads the tablet's light sensor when
`chrome://flags/#enable-generic-sensor-extra-classes` is enabled; other browsers, and Chrome without the flag, estimate
the lux with the front camera, which is rough. Browsers only allow the sensor and the camera over https, so serve the
display app with a certificate the tablets trust:

1. Install [mkcert](https://github.com/FiloSottile/mkcert) (`brew install mkcert`), run `mkcert -install`, then make a
   certificate for the names the tablets use:
   `mkdir -p certs && mkcert -key-file certs/homeydash-key.pem -cert-file certs/homeydash.pem homeydash.local 192.168.1.10` (your computer's name and address)
2. Trust mkcert's root (`mkcert -CAROOT` shows where `rootCA.pem` is) on every tablet:
   - Android: copy `rootCA.pem` over and install it under Settings → Security → Encryption & credentials → Install a
     certificate → CA certificate.
   - iPad: AirDrop or mail `rootCA.pem`, install the profile under Settings → General → VPN & Device Management, then
     turn on full trust under Settings → General → About → Certificate Trust Settings.
3. `npx nx serve display -c https`, and open `https://<address>:4200` on the tablet. Allow the camera when asked (on
   iPad, set Settings → Apps → Safari → Camera to Allow so it doesn't ask again).

The https address is a new origin, so each screen runs setup again: take over its existing display there.

To pick another camera, or see the lux a screen measured last and whether its sensor or camera gave it, tap its
top-right corner five times quickly to open its screen settings.

## Running

```sh
npx nx serve api          # API on :5112, which proxies the two apps below
npx nx serve display      # display app on :4200
npx nx serve management   # Management on :4201, under /admin
npx nx run-many -t test lint
```

Open everything through the API: the display app at `http://localhost:5112/` and Management at
`http://localhost:5112/admin/`. The API forwards every path outside `/api` and `/mcp` to the apps with YARP, so both
run on one origin. Set where it forwards to under `ReverseProxy:Clusters` in `apps/api/appsettings.json`.

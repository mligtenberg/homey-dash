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

## Running

```sh
npx nx serve api          # API on :5112, which both apps proxy /api to
npx nx serve display      # display app on :4200
npx nx serve management   # Management on :4201
npx nx run-many -t test lint
```

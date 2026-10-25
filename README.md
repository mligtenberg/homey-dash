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
(Settings → API keys) and give the API its address and key, for example with user-secrets:

```sh
dotnet user-secrets --project apps/api set Homey:Address http://192.168.1.10
dotnet user-secrets --project apps/api set Homey:ApiKey <key>
```

Without an address the API runs against a built-in fake Homey with a few sample devices,
flows and moods.

## Running

```sh
npx nx serve display      # display app, also starts the API
npx nx serve management   # Management, also starts the API
npx nx run-many -t test lint
```

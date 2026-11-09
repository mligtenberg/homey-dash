# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A single household. Family members glance at and touch wall-mounted or tablet displays placed around the home, for a second at a time, often from a distance. One admin (the repo owner) builds dashboards and assigns displays in Management.

## Product Purpose

HomeyDash is a configurable smart-home control surface for a Homey Pro, shown on screens around the home. Displays show published dashboards of tiles (devices, flows, moods, energy, weather, traffic, photos, Plex) and switch to rule-driven idle content when left alone. Management is where dashboards are drafted, previewed, published and assigned. Success: the household controls the home and sees what matters without opening a phone, and the screens stay pleasant to live with when idle.

## Positioning

Tiles are far richer than Homey's own app or generic dashboards: full Plex controls, a capable Apple TV remote (AirPlay), and content beyond Homey (Immich photos, TomTom traffic, weather). When left alone a display becomes a photo frame with a lock screen of widgets, driven by rules HomeyDash evaluates itself. HomeyDash is the only Homey client; both apps talk to its .NET API.

## Operating Context

- Displays: touch screens, often Fully Kiosk Browser, set up once per screen (Setup / Takeover), identified by a permanent identity.
- Dashboards have a fixed number of rows, no vertical scrolling; tiles never reflow.
- Management is a separate Angular app used on a desktop browser; the editor shows real tiles that cannot be operated.
- Runs on the home network, trusted by design (docs/adr/0001).

## Capabilities and Constraints

- Domain language is defined in CONTEXT.md and must be used in all UI copy (Dashboard, Display, Tile, Section, Publish, Draft, Photo set, Account; never page, kiosk, card, deploy).
- Stack: Angular apps (apps/display, apps/management), .NET API (apps/api), Nx workspace, shared libs (design-system, layout, tiles, api-client). Tile kinds are code modules (ADR 0003).
- Integrations: Homey, Immich, Plex, AirPlay, Open-Meteo/Buienradar, TomTom. Fake modes exist for development.
- Decisions live in docs/adr; component rules in docs/design-system.

## Brand Commitments

Existing design system (docs/design-system/README.md): displays are soft and tactile, each tile kind owns one hue; Management is flat, quiet, one `brand` accent. Plain English, sentence case, no emoji or exclamation marks. Treat as the incumbent; not re-derived here.

## Evidence on Hand

Real, working app with screenshots in docs/screenshots, ADRs, PRDs and component docs. No external customers, testimonials or metrics; none should be invented.

## Product Principles

- Glanceable first: read across a room, touched for a second.
- Rich tiles over generic switches; depth where the household actually uses it (media, photos).
- A display is calm when idle: it earns its place on the wall as a photo frame.
- Management stays out of the way of the tiles it arranges.
- One domain language, in code and in copy.

## Accessibility & Inclusion

No product-specific requirement beyond sensible defaults (readable contrast, adequate touch targets).

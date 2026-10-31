# Management is a separate app on its own port

The display app and Management are two separate Angular apps (`display` and `management`) served from the same container on different ports, sharing one backend. Displays all open one URL, and opening it on a new screen always triggers setup. Keeping Management on a different origin means a phone or laptop opening Management never becomes a display by accident.

## Considered Options

- **A `/manage` path on the display app.** Simpler to deploy, but it mixes kiosk and configuration concerns in one bundle.
- **A choice inside setup between "display" and "manage".** Rejected: one wrong answer turns your phone into a display.

## Consequences

Management needs its own HTTPS route in the reverse proxy. Its separate port is also how access can be restricted, given there is no authentication ([ADR-0001](0001-trust-the-home-network.md)).

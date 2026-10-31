# HomeyDash is the only client of Homey, over the local API

Displays never talk to Homey. The HomeyDash backend holds the single Homey credential (a local API key on the Homey Pro), keeps one live connection to Homey for state changes, and pushes updates to displays. Displays send their actions to HomeyDash, which performs them on Homey.

## Considered Options

- **Displays talk to Homey directly from the browser.** Rejected: every tablet would hold a Homey credential and its own live connection, and "a display never changes configuration" would be enforced only in the frontend.
- **Homey Cloud API.** Rejected: the displays must keep working when the internet is down.
- **A Homey app on the Homey Pro.** Rejected: it ties the whole product to Homey's app SDK and does not fit the .NET backend with SQLite.

## Consequences

The backend is not a thin CRUD layer. It owns the Homey connection (one per Homey account, [ADR-0007](0007-accounts-set-up-in-management.md)), reconnects after failures, and fans out updates. "Connection lost" on a display covers both "HomeyDash unreachable" and "a Homey unreachable from HomeyDash". The second locks only that Homey's tiles.

# Trust the home network; no authentication

HomeyDash runs only on the local network, so neither displays nor Management authenticate. Anyone on the network can open a display, run setup, or change configuration in Management. We accepted this because a PIN or login on wall tablets adds friction for every household member, and the home network is already the trust boundary for Homey itself.

## Consequences

- Every endpoint is open. Adding authentication later touches all of them, so do it before HomeyDash is ever exposed outside the home.
- Because Management runs on its own port (see [ADR-0004](0004-management-as-separate-app.md)), access to it can be restricted at the network level without writing auth code.

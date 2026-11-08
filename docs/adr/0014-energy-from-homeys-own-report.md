# The energy tile shows Homey's own energy report, read by HomeyDash

The energy tile shows the grid power (import or export), solar production and the home's consumption now, today's totals
and the day by the hour. HomeyDash reads them from the local Homey API like everything else in Homey: the live power from
`GET api/manager/energy/live` every 10 seconds and today's report from `report/day?date=` every 5 minutes, both needing the
`homey.energy.readonly` scope. They are held in the Homey's state, pushed over the realtime connection as `Energy` (and
with the `Homey` snapshot), and displays never call Homey. An API key without the scope, or a Homey without energy, gives
an `unavailable` report, which the tile shows as an unavailable face, not a missing one.

Homey doesn't document the JSON of these two endpoints, so `HomeyMapper.EnergyLive` and `EnergyDay` read them leniently
(each figure under any plausible name, as a number or as `{ W }` / `{ kWh }`), and the grid power, if Homey gives none, is
the home's consumption minus the production. The shape was written without a real response; check it and fix only the mapper.

## Considered Options

- **Pick the devices** (the meter, the inverter) in the tile's settings and read their capabilities. Rejected by the user:
  Homey's energy report already adds up the devices and knows which are the meter and the solar panels.
- **Homey's insight logs of the energy manager.** Rejected for live power: they are logs, minutes behind, and the report is
  what Homey's own energy page shows.

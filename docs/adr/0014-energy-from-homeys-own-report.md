# The energy tile shows Homey's own energy report, read by HomeyDash

The energy tile shows the grid power (import or export), solar production and the home's consumption now, today's totals
and the day by the hour. HomeyDash reads them from the local Homey API like everything else in Homey: the live power from
`GET api/manager/energy/live` every 10 seconds and today's report from `report/day?date=` every 5 minutes, both needing the
`homey.energy.readonly` scope. They are held in the Homey's state, pushed over the realtime connection as `Energy` (and
with the `Homey` snapshot), and displays never call Homey. An API key without the scope, or a Homey without energy, gives
an `unavailable` report, which the tile shows as an unavailable face, not a missing one.

Homey doesn't document the JSON of these two endpoints; `HomeyMapper.EnergyLive` and `EnergyDay` read them as a Homey Pro
(2023) answers. In the live report `totalCumulative.W` is the energy meter's power (a P1 meter): the grid, negative while
exporting. `totalConsumed.W` only adds up the devices that measure or estimate their own power, so it is the home's use only
when there is no meter; with one, the home uses the grid plus the sun (`totalGenerated.W`). The day report holds today under
`electricity`: `importedPeriod`, `exportedPeriod` and `generatedPeriod` in kWh, the cost as `importedPrice` less
`exportedPrice`, the meter's power every 5 minutes as `cumulativeMeasurePower`, and what each device used as
`devices.consumed`; `subReports` holds the same per hour. The currency comes from `GET api/manager/energy/currency`, once.

## Considered Options

- **Pick the devices** (the meter, the inverter) in the tile's settings and read their capabilities. Rejected by the user:
  Homey's energy report already adds up the devices and knows which are the meter and the solar panels.
- **Homey's insight logs of the energy manager.** Rejected for live power: they are logs, minutes behind, and the report is
  what Homey's own energy page shows.

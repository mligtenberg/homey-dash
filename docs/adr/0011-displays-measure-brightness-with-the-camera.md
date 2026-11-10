# Displays measure the light in lux, with a light sensor or else the camera

Each display measures how much light falls on it, in lux, so rules can use it as a display signal (`display:brightness`, see [ADR-0010](0010-rules-evaluated-by-homeydash-on-subscription.md)). Once a screen is a display, it measures every minute and reports over the realtime connection; HomeyDash keeps each display's last lux in memory only.

Where the browser has a light sensor (the Ambient Light Sensor API: Chrome with its Generic Sensor Extra Classes flag on, on a tablet that has the sensor) it reads it. Elsewhere it estimates lux with the front camera, running it for about a second and a half, and works the lux out from the frame's light and the exposure it was taken at, as an incident light meter does (2.5·N²/t·100/ISO lux makes middle grey, taking f/2.2 for the lens). Where the camera allows it (Chrome on Android) the exposure is fixed, at 1/60 s ISO 100 and again at 1/8 s ISO 800 for a room too dark for that, so the estimate follows the light from about 1 to 4000 lx. Where it doesn't (Safari on iPad, Firefox) automatic exposure evens rooms out and an exposure that makes 300 lx middle grey is assumed, so the estimate mostly tells dark from light.

## Considered Options

- **A level from 0 to 100 in the camera's own terms.** Replaced: thresholds meant nothing outside one tablet, and a light sensor's real lux could not share the signal.
- **Only the Ambient Light Sensor API.** Rejected: Chrome on Android only offers it behind a flag, and Safari not at all; the camera covers the rest.
- **A kiosk browser's sensor bridge (Fully Kiosk) or our own native wrapper.** Rejected for now: real lux, but Android only, and an app to install and keep up to date on every tablet. iPadOS has no public light sensor API, so even a native app would use the camera there.

## Consequences

- The sensor and the camera both need a secure context, so a display measures only when opened over https (`npx nx serve display -c https`) with a certificate its tablet trusts, or on localhost. Over plain http, as [ADR-0001](0001-trust-the-home-network.md) otherwise allows, it simply never reports, and conditions on its brightness fail.
- A camera estimate is rough, more so with automatic exposure, and differs between tablets; thresholds are best checked against what a display reports. A light sensor that fails once, such as one the browser offers but the tablet lacks, is passed over for the camera until the display reloads.
- A computer's cameras face no way, so without a pick the first real camera is used, passing over virtual ones (OBS, Insta360). The **Screen settings** (five quick taps in the top-right corner) pick a camera for that screen and show the last lux and whether the sensor or the camera gave it.
- A refused or missing camera stops measuring until the display reloads or another camera is picked. The camera-in-use indicator shows for each measurement.
- Moving a display from http to https changes its origin, so its screen forgets its screen id and runs setup again; a takeover keeps the display.
- A display also picks its light or dark theme from the lux it measures (`data-theme` on `<html>`): dark below 15 lx, light above 50, unchanged in between so a rough estimate near the line doesn't flicker. Until the first measurement, or where it can't measure, the device's own color-scheme preference applies.

"""Where the rooms and devices come from: the HomeyDash API (HOMEY_DASH_URL).

The API's /api/homey/devices already knows every device's room (zoneName), class (light, thermostat, ...) and
capabilities, so there is no second list to keep in step. The result has the shape the matcher wants:
    {"zones": [...], "devices": [{"id", "name", "zone", "kind", "caps"}]}
Only lights and thermostats are kept: those are the only things voice exposes.
"""
from __future__ import annotations

import json
import logging
import time
import urllib.request
from pathlib import Path

log = logging.getLogger("voice.catalog")

KIND = {"light": "light", "thermostat": "thermostat", "heater": "thermostat"}


def from_devices(devices: list[dict]) -> dict:
    out, zones = [], []
    for d in devices:
        kind, zone = KIND.get(d.get("class", "")), d.get("zoneName")
        if not kind or not zone or not d.get("available", True):
            continue
        caps = [cid for cid, c in (d.get("capabilities") or {}).items() if c.get("setable")]
        out.append({"id": d["id"], "name": d["name"], "zone": zone, "kind": kind, "caps": caps})
        if zone not in zones:
            zones.append(zone)
    return {"zones": zones, "devices": out}


class CatalogUnavailable(Exception):
    """HomeyDash could not be asked for its rooms and devices, and none was got before."""


class CatalogSource:
    def __init__(self, api_url: str, ttl: float = 60.0):
        self.api_url, self.ttl = api_url.rstrip("/"), ttl
        self._catalog: dict | None = None
        self._at = 0.0

    def get(self) -> dict:
        """Current catalog; refreshed from the API at most every `ttl` seconds, the last good one kept if it fails.
        There is no stand-in: commands go to real devices, so without HomeyDash there is nothing to match against."""
        if self._catalog is None or time.time() - self._at > self.ttl:
            self._at = time.time()  # also after a failure, so a down API is not retried on every request
            try:
                with urllib.request.urlopen(f"{self.api_url}/api/homey/devices", timeout=5) as r:
                    self._catalog = from_devices(json.load(r))
                log.info("catalog from %s: %d rooms, %d devices", self.api_url, len(self._catalog["zones"]), len(self._catalog["devices"]))
            except Exception as e:
                log.warning("catalog from %s failed: %s", self.api_url, e)
        if self._catalog is None:
            raise CatalogUnavailable(self.api_url)
        return self._catalog

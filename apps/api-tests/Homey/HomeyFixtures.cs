namespace HomeyDash.Api.Tests.Homey;

// Trimmed responses in the shape of Homey's local API v3.
public static class HomeyFixtures
{
    public const string Zones = """
        {
          "zone-home": { "id": "zone-home", "name": "Home", "parent": null },
          "zone-living": { "id": "zone-living", "name": "Living room", "parent": "zone-home" }
        }
        """;

    public const string Devices = """
        {
          "lamp": {
            "id": "lamp",
            "name": "Reading lamp",
            "zone": "zone-living",
            "class": "light",
            "available": false,
            "unavailableMessage": "Out of range",
            "capabilities": ["onoff", "dim"],
            "capabilitiesObj": {
              "onoff": { "id": "onoff", "type": "boolean", "title": "Turned on", "value": true, "setable": true, "getable": true },
              "dim": { "id": "dim", "type": "number", "title": "Dim level", "value": 0.4, "min": 0, "max": 1, "step": 0.01,
                       "setable": true, "getable": true, "lastUpdated": "2026-10-25T12:00:00.000Z" }
            }
          },
          "speaker": {
            "id": "speaker",
            "name": "Kitchen",
            "zone": "zone-living",
            "class": "speaker",
            "capabilitiesObj": {
              "speaker_playing": { "id": "speaker_playing", "type": "boolean", "title": "Playing", "value": true, "setable": true, "getable": true }
            },
            "images": [
              { "id": "albumart", "type": "media",
                "imageObj": { "id": "art-1", "url": "/api/image/art-1", "lastUpdated": 1792643825559, "ownerUri": "homey:device:speaker" } }
            ]
          }
        }
        """;

    public const string Flows = """
        { "f1": { "id": "f1", "name": "Good night", "enabled": true, "folder": "ff1" } }
        """;

    public const string AdvancedFlows = """
        { "a1": { "id": "a1", "name": "Leaving home", "enabled": true } }
        """;

    public const string FlowFolders = """
        { "ff1": { "id": "ff1", "name": "Evening", "parent": null } }
        """;

    public const string Moods = """
        {
          "m1": {
            "id": "m1", "name": "Movie night", "zone": "zone-living",
            "devices": {
              "lamp-1": { "state": { "onoff": true, "dim": 0.3, "light_mode": "color", "light_hue": 0.6, "light_saturation": 0.8, "light_temperature": 1 } },
              "lamp-2": { "state": { "onoff": true, "dim": 0.2, "light_mode": "temperature", "light_hue": 0.9, "light_temperature": 1 } },
              "lamp-3": { "state": { "onoff": false, "light_hue": 0.1 } },
              "plug-1": { "state": { "onoff": true } }
            }
          }
        }
        """;

    public const string Variables = """
        {
          "v1": { "id": "v1", "name": "House mode", "type": "string", "value": "Home" },
          "v2": { "id": "v2", "name": "Guests", "type": "boolean", "value": false }
        }
        """;
}

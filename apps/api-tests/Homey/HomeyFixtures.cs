namespace HomeyDash.Api.Tests.Homey;

// Trimmed responses in the shape of Homey's local API v3.
public static class HomeyFixtures
{
    public const string Zones = """
        { "zone-living": { "id": "zone-living", "name": "Living room", "parent": null } }
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
          }
        }
        """;

    public const string Flows = """
        { "f1": { "id": "f1", "name": "Good night", "enabled": true } }
        """;

    public const string AdvancedFlows = """
        { "a1": { "id": "a1", "name": "Leaving home", "enabled": true } }
        """;

    public const string Moods = """
        { "m1": { "id": "m1", "name": "Movie night", "zone": "zone-living" } }
        """;
}

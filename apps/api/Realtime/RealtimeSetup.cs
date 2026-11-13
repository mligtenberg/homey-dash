using System.Text.Json;
using System.Text.Json.Serialization;
using HomeyDash.Api.Displays;

namespace HomeyDash.Api.Realtime;

public static class RealtimeSetup
{
    public static IServiceCollection AddRealtime(this IServiceCollection services)
    {
        services.AddSignalR().AddJsonProtocol(options =>
            options.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));
        services.AddSingleton<DisplayPresence>();
        services.AddSingleton<RealtimeNotifier>();
        services.AddSingleton<ScreenshotBroker>();
        services.AddSingleton<MemoBroker>();
        services.AddHostedService<HomeyBroadcaster>();
        return services;
    }
}

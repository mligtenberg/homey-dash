using System.Text.Json;
using HomeyDash.Api.Accounts;

namespace HomeyDash.Api.Homey;

public static class HomeyEndpoints
{
    public static IServiceCollection AddHomey(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection("Homey").Get<HomeyOptions>() ?? new HomeyOptions();
        services.AddSingleton(options);
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<HomeyState>();
        services.AddSingleton<CurrentHomeyAccount>();

        if (options.Fake)
        {
            services.AddSingleton<FakeHomey>();
            services.AddSingleton<IHomey>(sp => sp.GetRequiredService<FakeHomey>());
            services.AddHostedService(sp => sp.GetRequiredService<FakeHomey>());
        }
        else
        {
            services.AddHttpClient(LocalHomey.HttpClientName);
            services.AddSingleton<LocalHomey>();
            services.AddSingleton<IHomey>(sp => sp.GetRequiredService<LocalHomey>());
            services.AddHostedService(sp => sp.GetRequiredService<LocalHomey>());
        }
        return services;
    }

    public static void MapHomey(this RouteGroupBuilder api)
    {
        var homey = api.MapGroup("/homey");

        homey.MapGet("/status", (HomeyState state) => state.Status);
        homey.MapGet("/devices", (HomeyState state) => state.Devices.OrderBy(d => d.Name));
        homey.MapGet("/flows", (HomeyState state) => state.Flows.OrderBy(f => f.Name));
        homey.MapGet("/moods", (HomeyState state) => state.Moods.OrderBy(m => m.Name));
        homey.MapGet("/insights", (IHomey h, CancellationToken ct) => Perform(async () => Results.Ok(await h.GetInsightLogsAsync(ct))));

        homey.MapGet("/insights/entries", (string log, string resolution, IHomey h, CancellationToken ct) =>
            Perform(async () =>
            {
                if (!InsightResolutions.All.Contains(resolution))
                    throw new ArgumentException($"Unknown resolution {resolution}");
                return Results.Ok(await h.GetInsightEntriesAsync(log, resolution, ct));
            }));

        homey.MapPut("/devices/{deviceId}/capabilities/{capabilityId}",
            (string deviceId, string capabilityId, CapabilityValue body, IHomey h, CancellationToken ct) =>
                Perform(async () =>
                {
                    await h.SetCapabilityValueAsync(deviceId, capabilityId, body.Value, ct);
                    return Results.NoContent();
                }));
        homey.MapPost("/flows/{flowId}/trigger", (string flowId, IHomey h, CancellationToken ct) =>
            Perform(async () =>
            {
                await h.TriggerFlowAsync(flowId, ct);
                return Results.NoContent();
            }));
        homey.MapPost("/moods/{moodId}/activate", (string moodId, IHomey h, CancellationToken ct) =>
            Perform(async () =>
            {
                await h.ActivateMoodAsync(moodId, ct);
                return Results.NoContent();
            }));
    }

    public sealed record CapabilityValue(JsonElement Value);

    private static async Task<IResult> Perform(Func<Task<IResult>> action)
    {
        try
        {
            return await action();
        }
        catch (HomeyNotFoundException e)
        {
            return Results.Problem(e.Message, statusCode: StatusCodes.Status404NotFound);
        }
        catch (ArgumentException e)
        {
            return Results.Problem(e.Message, statusCode: StatusCodes.Status400BadRequest);
        }
        catch (Exception e) when (e is HomeyUnavailableException or HttpRequestException)
        {
            return Results.Problem(e.Message, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}

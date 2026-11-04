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
        services.AddSingleton<Homeys>();
        services.AddSingleton<HomeyAccounts>();

        if (options.Fake)
        {
            services.AddHostedService<FakeHomey>();
        }
        else
        {
            services.AddHttpClient(LocalHomey.HttpClientName);
            services.AddHostedService<LocalHomeys>();
        }
        return services;
    }

    // Each route reads the Homey of ?account=, or of the oldest account when it names none.
    public static void MapHomey(this RouteGroupBuilder api)
    {
        var homey = api.MapGroup("/homey");

        homey.MapGet("/status", (int? account, Homeys homeys, TimeProvider time) =>
            homeys.For(account) is { } entry ? Results.Ok(entry.State.Status)
            : account is null ? Results.Ok(new HomeyStatus(0, HomeyConnection.NotSetUp, null, time.GetUtcNow(), Fake: false))
            : NoAccount(account));
        homey.MapGet("/devices", (int? account, Homeys homeys) => Read(homeys, account, s => s.Devices.OrderBy(d => d.Name)));
        homey.MapGet("/flows", (int? account, Homeys homeys) => Read(homeys, account, s => s.Flows.OrderBy(f => f.Name)));
        homey.MapGet("/moods", (int? account, Homeys homeys) => Read(homeys, account, s => s.Moods.OrderBy(m => m.Name)));
        homey.MapGet("/insights", (int? account, Homeys homeys, CancellationToken ct) =>
            Perform(async () => Results.Ok(await homeys.Require(account).GetInsightLogsAsync(ct))));

        homey.MapGet("/insights/entries", (string log, string resolution, int? account, Homeys homeys, CancellationToken ct) =>
            Perform(async () =>
            {
                if (!InsightResolutions.All.Contains(resolution))
                    throw new ArgumentException($"Unknown resolution {resolution}");
                return Results.Ok(await homeys.Require(account).GetInsightEntriesAsync(log, resolution, ct));
            }));

        // Only pictures of devices, so HomeyDash does not hand out whatever else Homey keeps. The URL carries the
        // picture's version, so a new picture is a new URL and an old one can be cached.
        homey.MapGet("/images/{imageId}", (string imageId, int? account, Homeys homeys, HttpResponse response, CancellationToken ct) =>
            Perform(async () =>
            {
                var homey = homeys.Require(account);
                if (!homey.State.Devices.Any(d => d.AlbumArt?.Id == imageId)) return Results.NotFound();
                if (await homey.GetImageAsync(imageId, ct) is not { } image) return Results.NotFound();
                response.Headers.CacheControl = "public, max-age=86400";
                return Results.File(image.Content, image.ContentType);
            }));

        homey.MapPut("/devices/{deviceId}/capabilities/{capabilityId}",
            (string deviceId, string capabilityId, int? account, CapabilityValue body, Homeys homeys, CancellationToken ct) =>
                Perform(async () =>
                {
                    await homeys.Require(account).SetCapabilityValueAsync(deviceId, capabilityId, body.Value, ct);
                    return Results.NoContent();
                }));
        homey.MapPost("/flows/{flowId}/trigger", (string flowId, int? account, Homeys homeys, CancellationToken ct) =>
            Perform(async () =>
            {
                await homeys.Require(account).TriggerFlowAsync(flowId, ct);
                return Results.NoContent();
            }));
        homey.MapPost("/moods/{moodId}/activate", (string moodId, int? account, Homeys homeys, CancellationToken ct) =>
            Perform(async () =>
            {
                await homeys.Require(account).ActivateMoodAsync(moodId, ct);
                return Results.NoContent();
            }));
    }

    // With no account at all, there is nothing in Homey yet.
    private static IResult Read<T>(Homeys homeys, int? account, Func<HomeyState, IEnumerable<T>> read) =>
        homeys.For(account) is { } entry ? Results.Ok(read(entry.State))
        : account is null ? Results.Ok(Array.Empty<T>())
        : NoAccount(account);

    private static IResult NoAccount(int? account) =>
        Results.Problem($"There is no Homey account {account}.", statusCode: StatusCodes.Status404NotFound);

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

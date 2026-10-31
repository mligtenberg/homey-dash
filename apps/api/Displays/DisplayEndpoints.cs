using HomeyDash.Api.Data;
using HomeyDash.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Displays;

public static class DisplayEndpoints
{
    public sealed record Setup(string? Name, Guid ScreenId);

    public sealed record Takeover(Guid ScreenId);

    public sealed record Rename(string? Name);

    // The main dashboard and the others the display can switch to, in the order it offers them.
    public sealed record Assignment(Guid? DashboardId, List<Guid>? OtherDashboardIds);

    public static void MapDisplays(this RouteGroupBuilder api)
    {
        var displays = api.MapGroup("/displays");

        displays.MapGet("/", (HomeyDashDbContext db, DisplayPresence presence, CancellationToken ct) =>
            DisplayQueries.ListAsync(db, presence, ct));

        // Setup: the screen becomes a new display.
        displays.MapPost("/", async (Setup body, HomeyDashDbContext db, RealtimeNotifier notifier, CancellationToken ct) =>
        {
            if (Display.ValidateName(body.Name) is { } error) return NameProblem(error);
            if (body.ScreenId == Guid.Empty) return ScreenProblem();

            await ReleaseScreenAsync(db, body.ScreenId, ct);
            var display = new Display { Name = body.Name!.Trim(), ScreenId = body.ScreenId };
            db.Displays.Add(display);
            await db.SaveChangesAsync(ct);
            await notifier.ScreensChangedAsync(db, [body.ScreenId], ct);
            return Results.Created($"/api/displays/{display.Id}", display.ToSummary());
        });

        // Setup: the screen takes over an existing display. The screen that held it returns to setup.
        displays.MapPost("/{id:guid}/takeover", (Guid id, Takeover body, [AsParameters] Services services, CancellationToken ct) =>
            body.ScreenId == Guid.Empty
                ? Task.FromResult(ScreenProblem())
                : Change(id, services, ct, async display =>
                {
                    await ReleaseScreenAsync(services.Db, body.ScreenId, ct);
                    display.ScreenId = body.ScreenId;
                    display.Showing(new Dictionary<Guid, int>());
                    return null;
                }));

        displays.MapPatch("/{id:guid}", (Guid id, Rename body, [AsParameters] Services services, CancellationToken ct) =>
            Change(id, services, ct, display =>
            {
                if (Display.ValidateName(body.Name) is { } error) return Task.FromResult<IResult?>(NameProblem(error));
                display.Name = body.Name!.Trim();
                return Task.FromResult<IResult?>(null);
            }));

        // Only published dashboards can be assigned; no main dashboard makes the display wait.
        displays.MapPut("/{id:guid}/dashboard", (Guid id, Assignment body, [AsParameters] Services services, CancellationToken ct) =>
            Change(id, services, ct, async display =>
                await AssignAsync(services.Db, display, body.DashboardId, body.OtherDashboardIds ?? [], ct) is { } error
                    ? Results.ValidationProblem(new Dictionary<string, string[]> { ["dashboardId"] = [error] })
                    : null));

        displays.MapDelete("/{id:guid}", async (Guid id, HomeyDashDbContext db, RealtimeNotifier notifier, CancellationToken ct) =>
        {
            if (await db.Displays.FindAsync([id], ct) is not { } display) return NotFound(id);
            db.Displays.Remove(display);
            await db.SaveChangesAsync(ct);
            await notifier.ScreensChangedAsync(db, [display.ScreenId], ct);
            return Results.NoContent();
        });

        // A screen asks which display it is. 404 sends it to setup: it never was one, or it was taken over.
        api.MapGet("/screens/{screenId:guid}", async (Guid screenId, HomeyDashDbContext db, CancellationToken ct) =>
            await DisplayQueries.ScreenViewAsync(db, screenId, ct) is { } view
                ? Results.Ok(view)
                : Results.Problem("This screen is not a display.", statusCode: StatusCodes.Status404NotFound));
    }

    // What the endpoints that change a display need.
    public sealed record Services(HomeyDashDbContext Db, DisplayPresence Presence, RealtimeNotifier Notifier);

    /// <summary>
    /// Assigns a display its main dashboard and the others it can switch to; answers why not when it can't.
    /// Every dashboard must be published, and only a display with a main dashboard has others.
    /// </summary>
    public static async Task<string?> AssignAsync(
        HomeyDashDbContext db, Display display, Guid? main, IEnumerable<Guid> others, CancellationToken ct)
    {
        var rest = others.Where(o => o != main).Distinct().ToList();
        if (main is null && rest.Count > 0) return "Choose a main dashboard before adding others.";
        var ids = main is { } m ? [m, .. rest] : rest;
        var published = await db.Dashboards.Where(d => ids.Contains(d.Id)).ToDictionaryAsync(d => d.Id, d => d.Published is not null, ct);
        if (ids.Where(id => !published.ContainsKey(id)).Select(id => (Guid?)id).FirstOrDefault() is { } missing)
            return $"Dashboard {missing} not found.";
        if (ids.Any(id => !published[id])) return "Only a published dashboard can be assigned.";
        display.Assign(main, rest);
        return null;
    }

    // A screen holds at most one display, so whatever it held before is let go.
    private static async Task ReleaseScreenAsync(HomeyDashDbContext db, Guid screenId, CancellationToken ct)
    {
        foreach (var held in await db.Displays.Where(d => d.ScreenId == screenId).ToListAsync(ct))
            held.ScreenId = null;
    }

    // Loads a display, applies a change (which returns a problem to refuse it), tells the screens it moved
    // between, and answers with the result.
    private static async Task<IResult> Change(
        Guid id, Services services, CancellationToken ct, Func<Display, Task<IResult?>> change)
    {
        if (await services.Db.Displays.FindAsync([id], ct) is not { } display) return NotFound(id);
        var screenBefore = display.ScreenId;
        if (await change(display) is { } problem) return problem;
        await services.Db.SaveChangesAsync(ct);
        await services.Notifier.ScreensChangedAsync(services.Db, [screenBefore, display.ScreenId], ct);
        return Results.Ok(await DisplayQueries.InfoAsync(services.Db, services.Presence, display, ct));
    }

    private static IResult NotFound(Guid id) =>
        Results.Problem($"Display {id} not found", statusCode: StatusCodes.Status404NotFound);

    private static IResult NameProblem(string error) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [error] });

    private static IResult ScreenProblem() =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["screenId"] = ["A screen id is needed."] });
}

using HomeyDash.Api.Data;
using HomeyDash.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Displays;

public static class DisplayEndpoints
{
    public sealed record Setup(string? Name, Guid ScreenId);

    public sealed record Takeover(Guid ScreenId);

    public sealed record Rename(string? Name);

    public sealed record Assignment(Guid? DashboardId);

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
                    display.ShownVersion = null;
                    return null;
                }));

        displays.MapPatch("/{id:guid}", (Guid id, Rename body, [AsParameters] Services services, CancellationToken ct) =>
            Change(id, services, ct, display =>
            {
                if (Display.ValidateName(body.Name) is { } error) return Task.FromResult<IResult?>(NameProblem(error));
                display.Name = body.Name!.Trim();
                return Task.FromResult<IResult?>(null);
            }));

        // Only a published dashboard can be assigned; null makes the display wait.
        displays.MapPut("/{id:guid}/dashboard", (Guid id, Assignment body, [AsParameters] Services services, CancellationToken ct) =>
            Change(id, services, ct, async display =>
            {
                if (body.DashboardId is { } dashboardId)
                {
                    var dashboard = await services.Db.Dashboards.FindAsync([dashboardId], ct);
                    if (dashboard is not { Published: not null })
                        return Results.ValidationProblem(new Dictionary<string, string[]>
                        {
                            ["dashboardId"] = [dashboard is null ? "Dashboard not found." : "Only a published dashboard can be assigned."],
                        });
                }
                if (display.DashboardId != body.DashboardId) display.ShownVersion = null;
                display.DashboardId = body.DashboardId;
                return null;
            }));

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

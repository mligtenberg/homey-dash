using HomeyDash.Api.Data;
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

        displays.MapGet("/", async (HomeyDashDbContext db, CancellationToken ct) =>
            (await db.Displays.ToListAsync(ct))
            .OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(d => d.ToSummary()));

        // Setup: the screen becomes a new display.
        displays.MapPost("/", async (Setup body, HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (Display.ValidateName(body.Name) is { } error) return NameProblem(error);
            if (body.ScreenId == Guid.Empty) return ScreenProblem();

            await ReleaseScreenAsync(db, body.ScreenId, ct);
            var display = new Display { Name = body.Name!.Trim(), ScreenId = body.ScreenId };
            db.Displays.Add(display);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/displays/{display.Id}", display.ToSummary());
        });

        // Setup: the screen takes over an existing display. The screen that held it returns to setup.
        displays.MapPost("/{id:guid}/takeover", (Guid id, Takeover body, HomeyDashDbContext db, CancellationToken ct) =>
            body.ScreenId == Guid.Empty
                ? Task.FromResult(ScreenProblem())
                : Change(id, db, ct, async display =>
                {
                    await ReleaseScreenAsync(db, body.ScreenId, ct);
                    display.ScreenId = body.ScreenId;
                    return null;
                }));

        displays.MapPatch("/{id:guid}", (Guid id, Rename body, HomeyDashDbContext db, CancellationToken ct) =>
            Change(id, db, ct, display =>
            {
                if (Display.ValidateName(body.Name) is { } error) return Task.FromResult<IResult?>(NameProblem(error));
                display.Name = body.Name!.Trim();
                return Task.FromResult<IResult?>(null);
            }));

        // Only a published dashboard can be assigned; null makes the display wait.
        displays.MapPut("/{id:guid}/dashboard", (Guid id, Assignment body, HomeyDashDbContext db, CancellationToken ct) =>
            Change(id, db, ct, async display =>
            {
                if (body.DashboardId is { } dashboardId)
                {
                    var dashboard = await db.Dashboards.FindAsync([dashboardId], ct);
                    if (dashboard is not { Published: not null })
                        return Results.ValidationProblem(new Dictionary<string, string[]>
                        {
                            ["dashboardId"] = [dashboard is null ? "Dashboard not found." : "Only a published dashboard can be assigned."],
                        });
                }
                display.DashboardId = body.DashboardId;
                return null;
            }));

        displays.MapDelete("/{id:guid}", async (Guid id, HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (await db.Displays.FindAsync([id], ct) is not { } display) return NotFound(id);
            db.Displays.Remove(display);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // A screen asks which display it is. 404 sends it to setup: it never was one, or it was taken over.
        api.MapGet("/screens/{screenId:guid}", async (Guid screenId, HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (await db.Displays.SingleOrDefaultAsync(d => d.ScreenId == screenId, ct) is not { } display)
                return Results.Problem("This screen is not a display.", statusCode: StatusCodes.Status404NotFound);

            var dashboard = display.DashboardId is { } dashboardId ? await db.Dashboards.FindAsync([dashboardId], ct) : null;
            var shown = dashboard is { Published: { } published }
                ? new ShownDashboard(dashboard.Id, dashboard.Name, dashboard.PublishedVersion, published)
                : null;
            return Results.Ok(new ScreenView(display.ToSummary(), shown));
        });
    }

    // A screen holds at most one display, so whatever it held before is let go.
    private static async Task ReleaseScreenAsync(HomeyDashDbContext db, Guid screenId, CancellationToken ct)
    {
        foreach (var held in await db.Displays.Where(d => d.ScreenId == screenId).ToListAsync(ct))
            held.ScreenId = null;
    }

    // Loads a display, applies a change (which returns a problem to refuse it) and answers with the result.
    private static async Task<IResult> Change(
        Guid id, HomeyDashDbContext db, CancellationToken ct, Func<Display, Task<IResult?>> change)
    {
        if (await db.Displays.FindAsync([id], ct) is not { } display) return NotFound(id);
        if (await change(display) is { } problem) return problem;
        await db.SaveChangesAsync(ct);
        return Results.Ok(display.ToSummary());
    }

    private static IResult NotFound(Guid id) =>
        Results.Problem($"Display {id} not found", statusCode: StatusCodes.Status404NotFound);

    private static IResult NameProblem(string error) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [error] });

    private static IResult ScreenProblem() =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["screenId"] = ["A screen id is needed."] });
}

using System.Text.Json;
using HomeyDash.Api.Data;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Dashboards;

public static class DashboardEndpoints
{
    public sealed record NewDashboard(string? Name);

    public sealed record Rename(string? Name);

    public static void MapDashboards(this RouteGroupBuilder api)
    {
        var dashboards = api.MapGroup("/dashboards");

        dashboards.MapGet("/", (HomeyDashDbContext db, HomeyState homey, CancellationToken ct) => ListAsync(db, homey, ct));

        dashboards.MapGet("/{id:guid}", async (Guid id, HomeyDashDbContext db, HomeyState homey, CancellationToken ct) =>
            await db.Dashboards.FindAsync([id], ct) is { } dashboard
                ? Results.Ok(dashboard.ToDetail(homey))
                : NotFound(id));

        dashboards.MapPost("/", async (NewDashboard body, HomeyDashDbContext db, HomeyState homey, RealtimeNotifier notifier, CancellationToken ct) =>
        {
            if (DashboardValidator.ValidateName(body.Name) is { } error) return NameProblem(error);

            var dashboard = new Dashboard { Name = body.Name!.Trim() };
            db.Dashboards.Add(dashboard);
            await db.SaveChangesAsync(ct);
            await notifier.DashboardsChangedAsync(db, ct);
            return Results.Created($"/api/dashboards/{dashboard.Id}", dashboard.ToDetail(homey));
        });

        dashboards.MapPatch("/{id:guid}", (Guid id, Rename body, HomeyDashDbContext db, HomeyState homey, RealtimeNotifier notifier, CancellationToken ct) =>
            Change(id, db, homey, notifier, ct, dashboard =>
            {
                if (DashboardValidator.ValidateName(body.Name) is { } error) return NameProblem(error);
                dashboard.Name = body.Name!.Trim();
                return null;
            }));

        // Its displays go back to waiting.
        dashboards.MapDelete("/{id:guid}", async (Guid id, HomeyDashDbContext db, RealtimeNotifier notifier, CancellationToken ct) =>
        {
            if (await db.Dashboards.FindAsync([id], ct) is not { } dashboard) return NotFound(id);
            var screens = await ScreensShowingAsync(db, id, ct);
            db.Dashboards.Remove(dashboard);
            await db.SaveChangesAsync(ct);
            await notifier.ScreensChangedAsync(db, screens, ct);
            await notifier.DashboardsChangedAsync(db, ct);
            return Results.NoContent();
        });

        dashboards.MapPut("/{id:guid}/draft", (Guid id, DashboardLayout draft, HomeyDashDbContext db, HomeyState homey, RealtimeNotifier notifier, CancellationToken ct) =>
            Change(id, db, homey, notifier, ct, dashboard =>
            {
                var errors = DashboardValidator.Validate(draft);
                if (errors.Count > 0) return Results.ValidationProblem(errors, "The draft breaks the layout rules.");
                dashboard.SaveDraft(WithSettings(draft));
                return null;
            }));

        // Every display showing the dashboard switches to the new version at once.
        dashboards.MapPost("/{id:guid}/publish",
            async (Guid id, HomeyDashDbContext db, HomeyState homey, RealtimeNotifier notifier, TimeProvider time, CancellationToken ct) =>
            {
                var result = await Change(id, db, homey, notifier, ct, dashboard =>
                {
                    dashboard.Publish(time.GetUtcNow());
                    return null;
                });
                await notifier.ScreensChangedAsync(db, await ScreensShowingAsync(db, id, ct), ct);
                return result;
            });
    }

    // The screens of the displays assigned this dashboard.
    private static async Task<List<Guid?>> ScreensShowingAsync(HomeyDashDbContext db, Guid id, CancellationToken ct) =>
        await db.Displays.Where(d => d.DashboardId == id).Select(d => d.ScreenId).ToListAsync(ct);

    public static async Task<List<DashboardSummary>> ListAsync(HomeyDashDbContext db, HomeyState homey, CancellationToken ct) =>
        (await db.Dashboards.ToListAsync(ct))
        .OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
        .Select(d => d.ToSummary(homey))
        .ToList();

    // Loads a dashboard, applies a change (which returns a problem to refuse it), tells Management and answers
    // with the result.
    private static async Task<IResult> Change(
        Guid id, HomeyDashDbContext db, HomeyState homey, RealtimeNotifier notifier, CancellationToken ct, Func<Dashboard, IResult?> change)
    {
        if (await db.Dashboards.FindAsync([id], ct) is not { } dashboard) return NotFound(id);
        if (change(dashboard) is { } problem) return problem;
        await db.SaveChangesAsync(ct);
        await notifier.DashboardsChangedAsync(db, ct);
        return Results.Ok(dashboard.ToDetail(homey));
    }

    // A tile sent without settings gets an empty object, so every stored tile has one.
    private static DashboardLayout WithSettings(DashboardLayout layout)
    {
        var empty = JsonSerializer.SerializeToElement(new { });
        return layout with
        {
            Sections = layout.Sections
                .Select(s => s with
                {
                    Tiles = s.Tiles
                        .Select(t => t.Settings.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null ? t with { Settings = empty } : t)
                        .ToList(),
                })
                .ToList(),
        };
    }

    private static IResult NotFound(Guid id) =>
        Results.Problem($"Dashboard {id} not found", statusCode: StatusCodes.Status404NotFound);

    private static IResult NameProblem(string error) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [error] });
}

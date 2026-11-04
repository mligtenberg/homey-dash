using System.Text.Json;
using HomeyDash.Api.Data;
using HomeyDash.Api.Displays;
using HomeyDash.Api.Realtime;
using HomeyDash.Api.Rules;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Dashboards;

public static class DashboardEndpoints
{
    public sealed record NewDashboard(string? Name);

    public sealed record Rename(string? Name);

    public static void MapDashboards(this RouteGroupBuilder api)
    {
        var dashboards = api.MapGroup("/dashboards");

        dashboards.MapGet("/", (HomeyDashDbContext db, TargetCatalog targets, CancellationToken ct) => ListAsync(db, targets, ct));

        dashboards.MapGet("/{id:guid}", async (Guid id, HomeyDashDbContext db, TargetCatalog targets, CancellationToken ct) =>
            await db.Dashboards.FindAsync([id], ct) is { } dashboard
                ? Results.Ok(dashboard.ToDetail(targets))
                : NotFound(id));

        dashboards.MapPost("/", async (NewDashboard body, HomeyDashDbContext db, TargetCatalog targets, RealtimeNotifier notifier, CancellationToken ct) =>
        {
            if (DashboardValidator.ValidateName(body.Name) is { } error) return NameProblem(error);

            var dashboard = new Dashboard { Name = body.Name!.Trim() };
            db.Dashboards.Add(dashboard);
            await db.SaveChangesAsync(ct);
            await notifier.DashboardsChangedAsync(db, ct);
            return Results.Created($"/api/dashboards/{dashboard.Id}", dashboard.ToDetail(targets));
        });

        dashboards.MapPatch("/{id:guid}", (Guid id, Rename body, HomeyDashDbContext db, TargetCatalog targets, RealtimeNotifier notifier, CancellationToken ct) =>
            Change(id, db, targets, notifier, ct, dashboard =>
            {
                if (DashboardValidator.ValidateName(body.Name) is { } error) return NameProblem(error);
                dashboard.Name = body.Name!.Trim();
                return null;
            }));

        // Its displays stop offering it; one left without dashboards waits.
        dashboards.MapDelete("/{id:guid}", async (Guid id, HomeyDashDbContext db, RealtimeNotifier notifier, CancellationToken ct) =>
        {
            if (await db.Dashboards.FindAsync([id], ct) is not { } dashboard) return NotFound(id);
            var screens = await DisplayQueries.ScreensShowingAsync(db, id, ct);
            foreach (var display in await db.Displays.Where(d => d.Dashboards.Any(o => o.DashboardId == id)).ToListAsync(ct))
                display.Assign(display.DashboardIds.Where(d => d != id).ToList());
            db.Dashboards.Remove(dashboard);
            await db.SaveChangesAsync(ct);
            await notifier.ScreensChangedAsync(db, screens, ct);
            await notifier.DashboardsChangedAsync(db, ct);
            return Results.NoContent();
        });

        dashboards.MapPut("/{id:guid}/draft", (Guid id, DashboardLayout draft, HomeyDashDbContext db, TargetCatalog targets, RealtimeNotifier notifier,
            RuleEngine rules, CancellationToken ct) =>
            Change(id, db, targets, notifier, ct, dashboard =>
            {
                var errors = Validate(draft, rules);
                if (errors.Count > 0) return Results.ValidationProblem(errors, "The draft breaks the layout rules.");
                dashboard.SaveDraft(WithSettings(draft));
                return null;
            }));

        // Every display showing the dashboard switches to the new version at once.
        dashboards.MapPost("/{id:guid}/publish",
            async (Guid id, HomeyDashDbContext db, TargetCatalog targets, RealtimeNotifier notifier, TimeProvider time, CancellationToken ct) =>
            {
                var result = await Change(id, db, targets, notifier, ct, dashboard =>
                {
                    dashboard.Publish(time.GetUtcNow());
                    return null;
                });
                await notifier.ScreensChangedAsync(db, await DisplayQueries.ScreensShowingAsync(db, id, ct), ct);
                return result;
            });
    }

    public static async Task<List<DashboardSummary>> ListAsync(HomeyDashDbContext db, TargetCatalog targets, CancellationToken ct) =>
        (await db.Dashboards.ToListAsync(ct))
        .OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
        .Select(d => d.ToSummary(targets))
        .ToList();

    // Loads a dashboard, applies a change (which returns a problem to refuse it), tells Management and answers
    // with the result.
    private static async Task<IResult> Change(
        Guid id, HomeyDashDbContext db, TargetCatalog targets, RealtimeNotifier notifier, CancellationToken ct, Func<Dashboard, IResult?> change)
    {
        if (await db.Dashboards.FindAsync([id], ct) is not { } dashboard) return NotFound(id);
        if (change(dashboard) is { } problem) return problem;
        await db.SaveChangesAsync(ct);
        await notifier.DashboardsChangedAsync(db, ct);
        return Results.Ok(dashboard.ToDetail(targets));
    }

    // The layout rules, and the rules of its sections and logic tiles (ADR-0010).
    public static Dictionary<string, string[]> Validate(DashboardLayout draft, RuleEngine rules)
    {
        var errors = DashboardValidator.Validate(draft);
        foreach (var (key, messages) in LogicTiles.Validate(draft, rules))
            errors[key] = errors.TryGetValue(key, out var existing) ? [.. existing, .. messages] : messages;
        for (var s = 0; s < (draft.Sections?.Count ?? 0); s++)
        {
            if (draft.Sections![s]?.Rule is not { ValueKind: not JsonValueKind.Null } json) continue;
            var where = $"sections[{s}].rule";
            var (rule, error) = RuleEngine.Parse(json);
            if (rule is null) errors[where] = [error!];
            else foreach (var (key, message) in rules.Validate(rule))
                errors[$"{where}.{key}"] = errors.TryGetValue($"{where}.{key}", out var existing) ? [.. existing, message] : [message];
        }
        return errors;
    }

    // A tile sent without settings gets an empty object, so every stored tile has one.
    public static DashboardLayout WithSettings(DashboardLayout layout)
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

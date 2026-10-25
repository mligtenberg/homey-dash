using System.Text.Json;
using HomeyDash.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Dashboards;

public static class DashboardEndpoints
{
    public sealed record NewDashboard(string? Name);

    public sealed record Rename(string? Name);

    public static void MapDashboards(this RouteGroupBuilder api)
    {
        var dashboards = api.MapGroup("/dashboards");

        dashboards.MapGet("/", async (HomeyDashDbContext db, CancellationToken ct) =>
            (await db.Dashboards.ToListAsync(ct))
            .OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(d => d.ToSummary()));

        dashboards.MapGet("/{id:guid}", async (Guid id, HomeyDashDbContext db, CancellationToken ct) =>
            await db.Dashboards.FindAsync([id], ct) is { } dashboard
                ? Results.Ok(dashboard.ToDetail())
                : NotFound(id));

        dashboards.MapPost("/", async (NewDashboard body, HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (DashboardValidator.ValidateName(body.Name) is { } error) return NameProblem(error);

            var dashboard = new Dashboard { Name = body.Name!.Trim() };
            db.Dashboards.Add(dashboard);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/dashboards/{dashboard.Id}", dashboard.ToDetail());
        });

        dashboards.MapPatch("/{id:guid}", (Guid id, Rename body, HomeyDashDbContext db, CancellationToken ct) =>
            Change(id, db, ct, dashboard =>
            {
                if (DashboardValidator.ValidateName(body.Name) is { } error) return NameProblem(error);
                dashboard.Name = body.Name!.Trim();
                return null;
            }));

        dashboards.MapDelete("/{id:guid}", async (Guid id, HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (await db.Dashboards.FindAsync([id], ct) is not { } dashboard) return NotFound(id);
            db.Dashboards.Remove(dashboard);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        dashboards.MapPut("/{id:guid}/draft", (Guid id, DashboardLayout draft, HomeyDashDbContext db, CancellationToken ct) =>
            Change(id, db, ct, dashboard =>
            {
                var errors = DashboardValidator.Validate(draft);
                if (errors.Count > 0) return Results.ValidationProblem(errors, "The draft breaks the layout rules.");
                dashboard.SaveDraft(WithSettings(draft));
                return null;
            }));

        dashboards.MapPost("/{id:guid}/publish", (Guid id, HomeyDashDbContext db, TimeProvider time, CancellationToken ct) =>
            Change(id, db, ct, dashboard =>
            {
                dashboard.Publish(time.GetUtcNow());
                return null;
            }));
    }

    // Loads a dashboard, applies a change (which returns a problem to refuse it) and answers with the result.
    private static async Task<IResult> Change(
        Guid id, HomeyDashDbContext db, CancellationToken ct, Func<Dashboard, IResult?> change)
    {
        if (await db.Dashboards.FindAsync([id], ct) is not { } dashboard) return NotFound(id);
        if (change(dashboard) is { } problem) return problem;
        await db.SaveChangesAsync(ct);
        return Results.Ok(dashboard.ToDetail());
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

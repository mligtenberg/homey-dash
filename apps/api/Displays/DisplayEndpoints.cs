using System.Text.Json;
using System.Text.RegularExpressions;
using HomeyDash.Api.Data;
using HomeyDash.Api.Realtime;
using HomeyDash.Api.Rules;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Displays;

public static partial class DisplayEndpoints
{
    public sealed record Setup(string? Name, Guid ScreenId);

    public sealed record Takeover(Guid ScreenId);

    public sealed record Rename(string? Name);

    // The dashboards the display offers, in that order.
    public sealed record Assignment(List<Guid>? DashboardIds);

    // In order: the first whose rule holds is what the display shows when left alone.
    public sealed record IdleRules(List<IdleRule>? Rules);

    // In order; widgets in the same spot stack in this order.
    public sealed record LockScreen(List<LockWidget>? Widgets);

    private const int MaxScreenshotBytes = 8 * 1024 * 1024;

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

        // Only published dashboards can be assigned; none makes the display wait.
        displays.MapPut("/{id:guid}/dashboards", (Guid id, Assignment body, [AsParameters] Services services, CancellationToken ct) =>
            Change(id, services, ct, async display =>
                await AssignAsync(services.Db, display, body.DashboardIds ?? [], ct) is { } error
                    ? Results.ValidationProblem(new Dictionary<string, string[]> { ["dashboardIds"] = [error] })
                    : null));

        displays.MapPut("/{id:guid}/idle-rules", (Guid id, IdleRules body, RuleEngine engine, [AsParameters] Services services, CancellationToken ct) =>
            Change(id, services, ct, async display =>
                await SetIdleRulesAsync(services.Db, display, body.Rules ?? [], engine, ct) is { } errors
                    ? Results.ValidationProblem(errors, "These idle rules can't be used.")
                    : null));

        displays.MapPut("/{id:guid}/lock-screen", (Guid id, LockScreen body, RuleEngine engine, [AsParameters] Services services, CancellationToken ct) =>
            Change(id, services, ct, display => Task.FromResult<IResult?>(
                SetLockScreen(display, body.Widgets ?? [], engine) is { } errors
                    ? Results.ValidationProblem(errors, "These widgets can't be shown.")
                    : null)));

        // Asks the display's screen for a picture of what it shows now. 409: nothing is connected; 504: it didn't answer.
        displays.MapPost("/{id:guid}/screenshot", async (Guid id, HomeyDashDbContext db, DisplayPresence presence, ScreenshotBroker screenshots, CancellationToken ct) =>
        {
            if (await db.Displays.FindAsync([id], ct) is not { } display) return NotFound(id);
            if (display.ScreenId is not { } screenId || !presence.IsConnected(screenId))
                return Results.Problem("This display is not connected.", statusCode: StatusCodes.Status409Conflict);
            return await screenshots.RequestAsync(screenId, ct) is { } picture
                ? Results.File(picture, "image/jpeg")
                : Results.Problem("The display did not answer. Reload its page and try again.", statusCode: StatusCodes.Status504GatewayTimeout);
        });

        // A screen's answer to a screenshot it was asked for: the JPEG itself.
        api.MapPost("/screenshots/{requestId:guid}", async (Guid requestId, HttpRequest request, ScreenshotBroker screenshots, CancellationToken ct) =>
        {
            if (request.ContentLength is null or 0 or > MaxScreenshotBytes) return Results.Problem("Send the picture, at most 8 MB.", statusCode: StatusCodes.Status413PayloadTooLarge);
            using var picture = new MemoryStream();
            await request.Body.CopyToAsync(picture, ct);
            return screenshots.Complete(requestId, picture.ToArray()) ? Results.NoContent() : Results.NotFound();
        });

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
    /// Assigns a display the dashboards it offers, in order; answers why not when it can't. Every dashboard must be
    /// published.
    /// </summary>
    public static async Task<string?> AssignAsync(HomeyDashDbContext db, Display display, IEnumerable<Guid> dashboardIds, CancellationToken ct)
    {
        var ids = dashboardIds.Distinct().ToList();
        var published = await db.Dashboards.Where(d => ids.Contains(d.Id)).ToDictionaryAsync(d => d.Id, d => d.Published is not null, ct);
        if (ids.Where(id => !published.ContainsKey(id)).Select(id => (Guid?)id).FirstOrDefault() is { } missing)
            return $"Dashboard {missing} not found.";
        if (ids.Any(id => !published[id])) return "Only a published dashboard can be assigned.";
        display.Assign(ids);
        return null;
    }

    /// <summary>
    /// Gives a display the rules that choose what it shows when left alone; answers what is wrong, by rule, when it
    /// can't. Each holds a valid rule and does one thing: show one of the dashboards the display offers, or play a photo
    /// set or fill the screen with a colour (<c>#rrggbb</c>), either of which may name the offered dashboard a touch
    /// goes back to.
    /// </summary>
    public static async Task<Dictionary<string, string[]>?> SetIdleRulesAsync(
        HomeyDashDbContext db, Display display, IReadOnlyList<IdleRule> rules, RuleEngine engine, CancellationToken ct)
    {
        var setIds = rules.Select(r => r.PhotoSetId).OfType<Guid>().Distinct().ToList();
        var sets = await db.PhotoSets.Where(s => setIds.Contains(s.Id)).Select(s => s.Id).ToListAsync(ct);
        var errors = new Dictionary<string, string[]>();
        foreach (var (idle, i) in rules.Select((r, i) => (r, i)))
        {
            if (new object?[] { idle.DashboardId, idle.PhotoSetId, idle.Color, idle.ScreenOff ? true : null }.Count(a => a is not null) > 1)
                errors[$"rules[{i}]"] = ["A rule either shows a dashboard, plays a photo set, fills with a colour or turns the screen off, just one."];
            else if (idle.PhotoSetId is not null || idle.Color is not null || idle.ScreenOff)
            {
                if (idle.PhotoSetId is { } set && !sets.Contains(set))
                    errors[$"rules[{i}].photoSetId"] = [$"Photo set {set} not found."];
                if (idle.Color is { } color && !HexColor().IsMatch(color))
                    errors[$"rules[{i}].color"] = ["A colour is written as #rrggbb, such as #000000."];
                if (idle.ReturnDashboardId is { } back && !display.DashboardIds.Contains(back))
                    errors[$"rules[{i}].returnDashboardId"] = ["A touch can only go back to a dashboard the display offers."];
            }
            else if (idle.DashboardId is not { } shown || !display.DashboardIds.Contains(shown))
                errors[$"rules[{i}].dashboardId"] = ["Only a dashboard the display offers can be shown when it is left alone."];
            else if (idle.ReturnDashboardId is not null)
                errors[$"rules[{i}].returnDashboardId"] = ["Only a rule that plays a photo set, fills with a colour or turns the screen off goes back to a dashboard."];
            if (RuleSetup.Check(idle.Rule, engine).Error is { } error)
                errors[$"rules[{i}].rule"] = [error];
        }
        if (errors.Count > 0) return errors;
        display.IdleRules = rules.Select(r => r with { Rule = r.Rule.Clone() }).ToList();
        return null;
    }

    /// <summary>
    /// Gives a display what its lock screen shows; answers what is wrong, by widget, when it can't. Each widget is a
    /// clock, the weather (of a Homey account, or the oldest) or a value, which names a capability of a device in Homey
    /// as a signal (<c>homey:&lt;account&gt;:capability:&lt;device&gt;:&lt;capability&gt;</c>), in one of the spots. A widget can be
    /// hidden, or shown only while a valid rule holds.
    /// </summary>
    public static Dictionary<string, string[]>? SetLockScreen(Display display, IReadOnlyList<LockWidget> widgets, RuleEngine engine)
    {
        var errors = new Dictionary<string, string[]>();
        if (widgets.Count > LockWidget.Max) errors["widgets"] = [$"A lock screen shows at most {LockWidget.Max} widgets."];
        foreach (var (widget, i) in widgets.Select((w, i) => (w, i)))
        {
            if (!LockWidget.Kinds.Contains(widget.Kind))
                errors[$"widgets[{i}].kind"] = [$"A widget is one of {string.Join(", ", LockWidget.Kinds)}."];
            if (!LockWidget.Spots.Contains(widget.Spot))
                errors[$"widgets[{i}].spot"] = [$"A widget sits in one of {string.Join(", ", LockWidget.Spots)}."];
            if (widget.Kind == "value")
            {
                if (widget.Signal is not { } signal || !IsCapabilitySignal().IsMatch(signal) || engine.Find(signal) is null)
                    errors[$"widgets[{i}].signal"] = ["A value shows a capability of a device in Homey."];
            }
            else if (widget.Signal is not null)
                errors[$"widgets[{i}].signal"] = ["Only a value shows a signal."];
            if (widget.Account is not null && widget.Kind != "weather")
                errors[$"widgets[{i}].account"] = ["Only the weather names a Homey account."];
            if (widget.Rule is { ValueKind: not JsonValueKind.Null } rule && RuleSetup.Check(rule, engine).Error is { } error)
                errors[$"widgets[{i}].rule"] = [error];
        }
        if (errors.Count > 0) return errors;
        display.LockWidgets = widgets.Select(w => w.Rule is { ValueKind: not JsonValueKind.Null } rule ? w with { Rule = rule.Clone() } : w with { Rule = null }).ToList();
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

    [GeneratedRegex("^homey:[0-9]+:capability:[^:]+:[^:]+$")]
    private static partial Regex IsCapabilitySignal();

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColor();
}

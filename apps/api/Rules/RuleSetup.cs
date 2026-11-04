using System.Text.Json;
using HomeyDash.Api.Displays;

namespace HomeyDash.Api.Rules;

public static class RuleSetup
{
    public static IServiceCollection AddRules(this IServiceCollection services)
    {
        services.AddSingleton<DisplayDirectory>();
        services.AddSingleton<DisplayTouches>();
        services.AddSingleton<DisplayBrightness>();
        services.AddSignalSource<HomeySignals>();
        services.AddSignalSource<ClockSignals>();
        services.AddSignalSource<DisplaySignals>();
        services.AddSignalSource<PlexSignals>();
        services.AddSingleton<RuleEngine>();
        services.AddSingleton<RuleSubscriptions>();
        return services;
    }

    // How a module adds its own signals.
    public static IServiceCollection AddSignalSource<T>(this IServiceCollection services) where T : class, ISignalSource =>
        services.AddSingleton<ISignalSource, T>();

    // Rules evaluated once, as if on a display (or none), keyed by an id the caller chose.
    public sealed record Evaluation(Dictionary<string, JsonElement>? Rules, Guid? Display);

    public static void MapRules(this RouteGroupBuilder api)
    {
        var rules = api.MapGroup("/rules");

        // The signal catalogue: every signal there is now, with what helps people write conditions on it.
        rules.MapGet("/signals", (RuleEngine engine) => engine.Signals());

        // For a preview in Management; displays subscribe over the realtime connection instead.
        rules.MapPost("/evaluate", (Evaluation body, RuleEngine engine) =>
        {
            var errors = new Dictionary<string, string[]>();
            var parsed = new Dictionary<string, Rule>();
            foreach (var (id, json) in body.Rules ?? [])
            {
                var (rule, error) = RuleEngine.Parse(json);
                if (rule is null)
                    errors[$"rules.{id}"] = [error!];
                else if (engine.Validate(rule) is { Count: > 0 } problems)
                    foreach (var (key, message) in problems) errors[$"rules.{id}.{key}"] = [message];
                else
                    parsed[id] = rule;
            }
            if (errors.Count > 0) return Results.ValidationProblem(errors, "These rules can't be evaluated.");
            var context = new RuleContext(DisplayId: body.Display);
            return Results.Ok(parsed.ToDictionary(r => r.Key, r => engine.Evaluate(r.Value, context).Holds));
        });
    }

    // A rule sent over the realtime connection or the API, or why it can't be used.
    public static (Rule? Rule, string? Error) Check(JsonElement json, RuleEngine engine)
    {
        var (rule, error) = RuleEngine.Parse(json);
        if (rule is null) return (null, error);
        var problems = engine.Validate(rule);
        return problems.Count > 0 ? (null, string.Join(" ", problems.Select(p => $"{p.Key}: {p.Message}"))) : (rule, null);
    }
}

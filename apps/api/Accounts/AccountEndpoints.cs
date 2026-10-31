using HomeyDash.Api.Data;
using HomeyDash.Api.Homey;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Accounts;

// The accounts HomeyDash holds for the home (ADR-0007). Keys never leave the backend: reads only say what is set up.
public static class AccountEndpoints
{
    // ApiKey may be left out to keep the current key, such as when only the address changes.
    public sealed record HomeyAccountChange(string? Address, string? ApiKey);

    // Fake: the configuration runs HomeyDash against FakeHomey, so no account can be set up.
    public sealed record HomeyAccountInfo(bool Fake, string? Address);

    public static void MapAccounts(this RouteGroupBuilder api)
    {
        var homey = api.MapGroup("/accounts/homey");

        homey.MapGet("/", (HomeyOptions options, CurrentHomeyAccount current) => Info(options, current));

        homey.MapPut("/", async (HomeyAccountChange body, HomeyOptions options, CurrentHomeyAccount current,
            HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();

            Dictionary<string, string[]> errors = [];
            var address = NormalizeAddress(body.Address);
            if (address is null) errors["address"] = ["Enter Homey's address on the local network, such as 192.168.1.10."];
            var apiKey = string.IsNullOrWhiteSpace(body.ApiKey) ? current.Account?.ApiKey : body.ApiKey.Trim();
            if (apiKey is null) errors["apiKey"] = ["Enter a local API key, made in the Homey web app under Settings → API keys."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var account = new HomeyAccount(address!, apiKey!);
            var stored = await db.HomeyAccounts.SingleOrDefaultAsync(ct);
            if (stored is not null) db.HomeyAccounts.Remove(stored);
            db.HomeyAccounts.Add(account);
            await db.SaveChangesAsync(ct);
            current.Set(account);
            return Info(options, current);
        });

        homey.MapDelete("/", async (HomeyOptions options, CurrentHomeyAccount current, HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            await db.HomeyAccounts.ExecuteDeleteAsync(ct);
            current.Set(null);
            return Results.NoContent();
        });
    }

    // Reads the account kept in the database, before anything connects to Homey.
    public static void LoadAccounts(this IServiceProvider services)
    {
        var account = services.GetRequiredService<HomeyDashDbContext>().HomeyAccounts.AsNoTracking().SingleOrDefault();
        services.GetRequiredService<CurrentHomeyAccount>().Set(account);
    }

    // Accepts what people type, such as 192.168.1.10 or homey-123.local, as http://….
    public static string? NormalizeAddress(string? address)
    {
        if (string.IsNullOrWhiteSpace(address)) return null;
        address = address.Trim();
        if (!address.Contains("://")) address = "http://" + address;
        return Uri.TryCreate(address, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" && uri.Host != ""
            ? uri.GetLeftPart(UriPartial.Authority)
            : null;
    }

    private static IResult Info(HomeyOptions options, CurrentHomeyAccount current) =>
        Results.Ok(new HomeyAccountInfo(options.Fake, options.Fake ? null : current.Account?.Address));

    private static IResult FakeProblem() =>
        Results.Problem("HomeyDash runs against a fake Homey, set in its configuration.", statusCode: StatusCodes.Status409Conflict);
}

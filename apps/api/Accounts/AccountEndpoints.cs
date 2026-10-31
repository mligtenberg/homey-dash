using HomeyDash.Api.Data;
using HomeyDash.Api.Homey;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Accounts;

// The accounts HomeyDash holds for the home (ADR-0007). Keys never leave the backend: reads only say what is set up.
public static class AccountEndpoints
{
    // ApiKey may be left out to keep the current key, such as when only the address or name changes.
    public sealed record HomeyAccountChange(string? Name, string? Address, string? ApiKey);

    public sealed record HomeyAccountInfo(int Id, string Name, string Address);

    // Fake: the configuration runs HomeyDash against FakeHomey, whose one account can't be changed.
    public sealed record HomeyAccountsInfo(bool Fake, IReadOnlyList<HomeyAccountInfo> Accounts);

    public static void MapAccounts(this RouteGroupBuilder api)
    {
        var homey = api.MapGroup("/accounts/homey");

        homey.MapGet("/", (HomeyOptions options, HomeyAccounts accounts) => Info(options, accounts));

        homey.MapPost("/", async (HomeyAccountChange body, HomeyOptions options, HomeyAccounts accounts,
            HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            var (account, problem) = Check(body, null, accounts);
            if (account is null) return problem!;
            db.HomeyAccounts.Add(account);
            await db.SaveChangesAsync(ct);
            accounts.Set(await db.HomeyAccounts.AsNoTracking().ToListAsync(ct));
            return Info(options, accounts);
        });

        // Another address or key connects to it again; a new name only renames it.
        homey.MapPut("/{id:int}", async (int id, HomeyAccountChange body, HomeyOptions options, HomeyAccounts accounts,
            HomeyDashDbContext db, CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            if (await db.HomeyAccounts.FindAsync([id], ct) is not { } stored) return Results.NotFound();
            var (account, problem) = Check(body, stored, accounts);
            if (account is null) return problem!;
            db.Entry(stored).State = EntityState.Detached;
            db.HomeyAccounts.Update(account);
            await db.SaveChangesAsync(ct);
            accounts.Set(await db.HomeyAccounts.AsNoTracking().ToListAsync(ct));
            return Info(options, accounts);
        });

        // Tiles that name it show as missing until they are given another account.
        homey.MapDelete("/{id:int}", async (int id, HomeyOptions options, HomeyAccounts accounts, HomeyDashDbContext db,
            CancellationToken ct) =>
        {
            if (options.Fake) return FakeProblem();
            if (await db.HomeyAccounts.FindAsync([id], ct) is not { } account) return Results.NotFound();
            db.HomeyAccounts.Remove(account);
            await db.SaveChangesAsync(ct);
            accounts.Set(await db.HomeyAccounts.AsNoTracking().ToListAsync(ct));
            return Info(options, accounts);
        });
    }

    // Reads the accounts kept in the database, before anything connects to Homey.
    public static void LoadAccounts(this IServiceProvider services)
    {
        services.GetRequiredService<HomeyAccounts>().Set(services.GetRequiredService<HomeyOptions>().Fake
            ? [FakeHomey.Account]
            : services.GetRequiredService<HomeyDashDbContext>().HomeyAccounts.AsNoTracking().ToList());
    }

    private static (HomeyAccount? Account, IResult? Problem) Check(HomeyAccountChange body, HomeyAccount? stored, HomeyAccounts accounts)
    {
        Dictionary<string, string[]> errors = [];
        if (ValidateName(body.Name, accounts.All.Where(a => a.Id != stored?.Id).Select(a => a.Name)) is { } nameError)
            errors["name"] = [nameError];
        var address = NormalizeAddress(body.Address);
        if (address is null) errors["address"] = ["Enter Homey's address on the local network, such as 192.168.1.10."];
        var apiKey = string.IsNullOrWhiteSpace(body.ApiKey) ? stored?.ApiKey : body.ApiKey.Trim();
        if (apiKey is null) errors["apiKey"] = ["Enter a local API key, made in the Homey web app under Settings → API keys."];
        return errors.Count > 0
            ? (null, Results.ValidationProblem(errors))
            : (new HomeyAccount(address!, apiKey!) { Id = stored?.Id ?? 0, Name = body.Name!.Trim() }, null);
    }

    public const int MaxNameLength = 100;

    // Names tell a home's accounts of one kind apart, so two of them can't share one.
    public static string? ValidateName(string? name, IEnumerable<string> taken) =>
        string.IsNullOrWhiteSpace(name) ? "Give the account a name, such as whose it is."
        : name.Trim().Length > MaxNameLength ? $"Keep the name to {MaxNameLength} characters."
        : taken.Any(t => string.Equals(t, name.Trim(), StringComparison.CurrentCultureIgnoreCase)) ? "Another account already has that name."
        : null;

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

    private static IResult Info(HomeyOptions options, HomeyAccounts accounts) =>
        Results.Ok(new HomeyAccountsInfo(options.Fake, accounts.All.Select(a => new HomeyAccountInfo(a.Id, a.Name, a.Address)).ToList()));

    private static IResult FakeProblem() =>
        Results.Problem("HomeyDash runs against a fake Homey, set in its configuration.", statusCode: StatusCodes.Status409Conflict);
}

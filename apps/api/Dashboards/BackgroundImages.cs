using HomeyDash.Api.Data;
using HomeyDash.Api.Photos;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Dashboards;

/// <summary>
/// An image uploaded in Management for a dashboard's background (<see cref="DashboardBackground"/>), kept in
/// HomeyDash's own database. It never changes once uploaded, so displays may cache it for good.
/// </summary>
public sealed class BackgroundImage
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required byte[] Content { get; init; }
    public required string ContentType { get; init; }
    public DateTimeOffset UploadedAt { get; init; }
}

public sealed record UploadedBackground(Guid Id, string Url);

public static class BackgroundImageEndpoints
{
    public const int MaxBytes = 15 * 1024 * 1024;

    // An image no dashboard version uses any more is let go once it is this old; a newer one may still be on its way
    // into a draft.
    private static readonly TimeSpan Unused = TimeSpan.FromDays(1);

    public static string Url(Guid id) => $"/api/backgrounds/{id}";

    public static void MapBackgrounds(this RouteGroupBuilder api)
    {
        var backgrounds = api.MapGroup("/backgrounds");

        backgrounds.MapPost("/", async (IFormFile? file, HomeyDashDbContext db, TimeProvider time, CancellationToken ct) =>
        {
            if (file is null || file.Length == 0) return Problem("Send an image as the form field \"file\".");
            if (file.Length > MaxBytes) return Problem($"An image is at most {MaxBytes / 1024 / 1024} MB.");
            using var buffer = new MemoryStream();
            await file.CopyToAsync(buffer, ct);
            var content = buffer.ToArray();
            if (ContentType(content) is not { } type) return Problem("Only JPEG, PNG and WebP images can be a background.");

            await ForgetUnusedAsync(db, time.GetUtcNow(), ct);
            var image = new BackgroundImage { Content = content, ContentType = type, UploadedAt = time.GetUtcNow() };
            db.BackgroundImages.Add(image);
            await db.SaveChangesAsync(ct);
            return Results.Created(Url(image.Id), new UploadedBackground(image.Id, Url(image.Id)));
        }).DisableAntiforgery();

        // With a width and a height, a WebP of that size covering it, cropped around its middle; without, the upload.
        backgrounds.MapGet("/{id:guid}", async (Guid id, int? width, int? height, HomeyDashDbContext db, HttpContext http, CancellationToken ct) =>
        {
            if (ImageFit.Check(width, height) is { Count: > 0 } errors) return Results.ValidationProblem(errors);
            if (await db.BackgroundImages.FindAsync([id], ct) is not { } image) return Results.NotFound();
            http.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
            if (width is not null && height is not null)
            {
                using var content = new MemoryStream(image.Content);
                return ImageFit.Cover(content, width.Value, height.Value, Focus.Middle) is { } fitted
                    ? Results.Bytes(fitted, "image/webp")
                    : Results.Problem("The image can't be read.", statusCode: StatusCodes.Status500InternalServerError);
            }
            return Results.Bytes(image.Content, image.ContentType);
        });
    }

    /// <summary>Why a version's background can't be used: it names an image HomeyDash doesn't have.</summary>
    public static async Task<string?> MissingImageAsync(HomeyDashDbContext db, DashboardLayout layout, CancellationToken ct) =>
        layout.Background is { Kind: "image", ImageId: { } id } && !await db.BackgroundImages.AnyAsync(i => i.Id == id, ct)
            ? $"Background image {id} not found."
            : null;

    // What the image is, by its first bytes rather than what the upload claims.
    private static string? ContentType(byte[] content) => content switch
    {
        [0xFF, 0xD8, 0xFF, ..] => "image/jpeg",
        [0x89, (byte)'P', (byte)'N', (byte)'G', ..] => "image/png",
        [(byte)'R', (byte)'I', (byte)'F', (byte)'F', _, _, _, _, (byte)'W', (byte)'E', (byte)'B', (byte)'P', ..] => "image/webp",
        _ => null,
    };

    private static async Task ForgetUnusedAsync(HomeyDashDbContext db, DateTimeOffset now, CancellationToken ct)
    {
        var used = (await db.Dashboards.ToListAsync(ct))
            .SelectMany(d => new[] { d.Draft, d.Published })
            .Select(l => l?.Background?.ImageId)
            .OfType<Guid>()
            .ToHashSet();
        var before = now - Unused;
        // Compared in memory: SQLite can't compare DateTimeOffset.
        var old = (await db.BackgroundImages.Select(i => new { i.Id, i.UploadedAt }).ToListAsync(ct))
            .Where(i => i.UploadedAt < before && !used.Contains(i.Id))
            .Select(i => i.Id)
            .ToList();
        if (old.Count > 0) await db.BackgroundImages.Where(i => old.Contains(i.Id)).ExecuteDeleteAsync(ct);
    }

    private static IResult Problem(string error) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = [error] });
}

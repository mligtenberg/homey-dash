using HomeyDash.Api.Data;
using HomeyDash.Api.Displays;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Timers;

/// <summary>
/// A sound uploaded in Management for timers to ring with, kept in HomeyDash's own database. A timer or a display
/// names it as <see cref="SoundId"/> ("custom:" and its id), next to the built-in sounds.
/// </summary>
public sealed class CustomSound
{
    public const int MaxNameLength = 60;
    public const int MaxCount = 30;
    public const int MaxBytes = 3 * 1024 * 1024;
    public const string Prefix = "custom:";

    public Guid Id { get; init; } = Guid.NewGuid();
    public required string Name { get; set; }
    public required byte[] Content { get; init; }
    public required string ContentType { get; init; }
    public DateTimeOffset UploadedAt { get; init; }

    public string SoundId => Prefix + Id;

    /// <summary>Whether a timer or display may name this sound: a built-in one, or a custom one (which may since have gone).</summary>
    public static bool IsSound(string sound) =>
        TimerView.Sounds.Contains(sound) || (sound.StartsWith(Prefix, StringComparison.Ordinal) && Guid.TryParse(sound.AsSpan(Prefix.Length), out _));
}

/// <summary>A custom sound as Management lists it. Mirrored in libs/api-client/src/lib/sounds.ts.</summary>
public sealed record SoundView(string Id, string Name, string Url, long Bytes);

public static class CustomSoundEndpoints
{
    public static string Url(Guid id) => $"/api/sounds/{id}/audio";

    public static void MapSounds(this RouteGroupBuilder api)
    {
        var sounds = api.MapGroup("/sounds");

        sounds.MapGet("/", async (HomeyDashDbContext db, CancellationToken ct) =>
        {
            var all = await db.CustomSounds.AsNoTracking()
                .Select(s => new { s.Id, s.Name, s.UploadedAt, Bytes = s.Content.Length })
                .ToListAsync(ct);
            // Ordered in memory: SQLite can't order a DateTimeOffset.
            return all.OrderBy(s => s.UploadedAt).Select(s => new SoundView(CustomSound.Prefix + s.Id, s.Name, Url(s.Id), s.Bytes)).ToList();
        });

        sounds.MapPost("/", async (IFormFile? file, string? name, HomeyDashDbContext db, TimeProvider time, CancellationToken ct) =>
        {
            if (file is null || file.Length == 0) return Problem("file", "Send a sound as the form field \"file\".");
            if (file.Length > CustomSound.MaxBytes) return Problem("file", $"A sound is at most {CustomSound.MaxBytes / 1024 / 1024} MB.");
            if (await db.CustomSounds.CountAsync(ct) >= CustomSound.MaxCount) return Problem("file", "That is enough sounds.");
            using var buffer = new MemoryStream();
            await file.CopyToAsync(buffer, ct);
            var content = buffer.ToArray();
            if (ContentType(content) is not { } type) return Problem("file", "Only MP3, WAV, OGG and M4A sounds can be uploaded.");

            var label = (name ?? Path.GetFileNameWithoutExtension(file.FileName)).Trim();
            if (label.Length == 0) label = "Sound";
            var sound = new CustomSound { Name = label[..Math.Min(label.Length, CustomSound.MaxNameLength)], Content = content, ContentType = type, UploadedAt = time.GetUtcNow() };
            db.CustomSounds.Add(sound);
            await db.SaveChangesAsync(ct);
            return Results.Created(Url(sound.Id), new SoundView(sound.SoundId, sound.Name, Url(sound.Id), content.Length));
        }).DisableAntiforgery();

        sounds.MapPatch("/{id:guid}", async (Guid id, SoundName body, HomeyDashDbContext db, CancellationToken ct) =>
        {
            var name = body.Name?.Trim() ?? "";
            if (name.Length == 0 || name.Length > CustomSound.MaxNameLength) return Problem("name", $"A name is 1 to {CustomSound.MaxNameLength} characters.");
            if (await db.CustomSounds.FindAsync([id], ct) is not { } sound) return Results.NotFound();
            sound.Name = name;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new SoundView(sound.SoundId, sound.Name, Url(sound.Id), sound.Content.Length));
        });

        // What rang with it beeps instead, so no timer or display is left naming a sound that is gone.
        sounds.MapDelete("/{id:guid}", async (Guid id, HomeyDashDbContext db, CancellationToken ct) =>
        {
            var soundId = CustomSound.Prefix + id;
            if (await db.CustomSounds.Where(s => s.Id == id).ExecuteDeleteAsync(ct) == 0) return Results.NotFound();
            await db.Timers.Where(t => t.Sound == soundId).ExecuteUpdateAsync(s => s.SetProperty(t => t.Sound, "beep"), ct);
            await db.Displays.Where(d => d.TimerSound == soundId).ExecuteUpdateAsync(s => s.SetProperty(d => d.TimerSound, (string?)null), ct);
            return Results.NoContent();
        });

        sounds.MapGet("/{id:guid}/audio", async (Guid id, HomeyDashDbContext db, HttpContext http, CancellationToken ct) =>
        {
            if (await db.CustomSounds.FindAsync([id], ct) is not { } sound) return Results.NotFound();
            // A name changes, never the sound itself.
            http.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
            return Results.Bytes(sound.Content, sound.ContentType);
        });
    }

    public sealed record SoundName(string? Name);

    // What the sound is, by its first bytes rather than what the upload claims.
    private static string? ContentType(byte[] content) => content switch
    {
        [(byte)'I', (byte)'D', (byte)'3', ..] => "audio/mpeg",
        [0xFF, var b, ..] when (b & 0xE0) == 0xE0 => "audio/mpeg",
        [(byte)'R', (byte)'I', (byte)'F', (byte)'F', _, _, _, _, (byte)'W', (byte)'A', (byte)'V', (byte)'E', ..] => "audio/wav",
        [(byte)'O', (byte)'g', (byte)'g', (byte)'S', ..] => "audio/ogg",
        [_, _, _, _, (byte)'f', (byte)'t', (byte)'y', (byte)'p', ..] => "audio/mp4",
        _ => null,
    };

    private static IResult Problem(string field, string error) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [error] });
}

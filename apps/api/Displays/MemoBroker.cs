using System.Collections.Concurrent;
using System.IO.Compression;
using HomeyDash.Api.Realtime;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.Displays;

/// <summary>
/// Fetches the voice memos a screen keeps: asks the screen over its realtime connection, which posts each recording and its
/// text back under the id of the request; they are handed on as one zip. Recordings stay on the screen until asked for.
/// </summary>
public sealed class MemoBroker(IHubContext<RealtimeHub> hub)
{
    /// <summary>How long a screen has to answer; twenty recordings take a while over a tablet's wifi.</summary>
    public static readonly TimeSpan Wait = TimeSpan.FromSeconds(90);

    private readonly ConcurrentDictionary<Guid, TaskCompletionSource<byte[]>> _pending = new();

    /// <summary>The screen's memos as a zip, or null when it didn't answer in time.</summary>
    public async Task<byte[]?> RequestAsync(Guid screenId, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        var answer = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = answer;
        try
        {
            await hub.Clients.Group(RealtimeNotifier.ScreenGroup(screenId)).SendAsync("Memos", id, ct);
            return await answer.Task.WaitAsync(Wait, ct);
        }
        catch (TimeoutException)
        {
            return null;
        }
        finally
        {
            _pending.TryRemove(id, out _);
        }
    }

    /// <summary>Zips what the screen sent and hands it to whoever asked; false when nobody waits for it any more.</summary>
    public async Task<bool> CompleteAsync(Guid id, IFormFileCollection files, CancellationToken ct)
    {
        if (!_pending.ContainsKey(id)) return false;
        using var zip = new MemoryStream();
        using (var archive = new ZipArchive(zip, ZipArchiveMode.Create, leaveOpen: true))
            foreach (var file in files)
            {
                var entry = archive.CreateEntry(Path.GetFileName(file.FileName), CompressionLevel.Fastest);
                await using var to = entry.Open();
                await file.CopyToAsync(to, ct);
            }
        return _pending.TryGetValue(id, out var answer) && answer.TrySetResult(zip.ToArray());
    }
}

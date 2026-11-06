using System.Collections.Concurrent;
using HomeyDash.Api.Realtime;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.Displays;

/// <summary>
/// Takes a screenshot of what a screen shows: asks the screen over its realtime connection, which captures its page and
/// posts the picture back under the id of the request. Pictures are too big for a realtime message.
/// </summary>
public sealed class ScreenshotBroker(IHubContext<RealtimeHub> hub)
{
    /// <summary>How long a screen has to answer.</summary>
    public static readonly TimeSpan Wait = TimeSpan.FromSeconds(15);

    private readonly ConcurrentDictionary<Guid, TaskCompletionSource<byte[]>> _pending = new();

    /// <summary>The screen's picture as JPEG, or null when it didn't answer in time.</summary>
    public async Task<byte[]?> RequestAsync(Guid screenId, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        var answer = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = answer;
        try
        {
            await hub.Clients.Group(RealtimeNotifier.ScreenGroup(screenId)).SendAsync("Screenshot", id, ct);
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

    /// <summary>Hands the picture to whoever asked; false when nobody waits for it any more.</summary>
    public bool Complete(Guid id, byte[] picture) => _pending.TryGetValue(id, out var answer) && answer.TrySetResult(picture);
}

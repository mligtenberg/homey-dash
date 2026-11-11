using HomeyDash.Api.Data;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Timers;

public static class TimerEndpoints
{
    public static Task<List<TimerView>> ListAsync(HomeyDashDbContext db, CancellationToken ct) =>
        db.Timers.AsNoTracking().OrderBy(t => t.End).Select(t => TimerView.Of(t)).ToListAsync(ct);

    public static async Task SaveAsync(HomeyDashDbContext db, TimerView view, CancellationToken ct)
    {
        var timer = await db.Timers.FindAsync([view.Id], ct);
        if (timer is null)
        {
            if (await db.Timers.CountAsync(ct) >= SharedTimer.MaxTimers) throw new HubException("That is enough timers.");
            timer = new SharedTimer { Id = view.Id };
            db.Timers.Add(timer);
        }
        view.CopyTo(timer);
        await db.SaveChangesAsync(ct);
    }

    public static async Task RemoveAsync(HomeyDashDbContext db, Guid id, CancellationToken ct) =>
        await db.Timers.Where(t => t.Id == id).ExecuteDeleteAsync(ct);
}

using System.Text.Json;
using HomeyDash.Api.Dashboards;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Data;

public class HomeyDashDbContext(DbContextOptions<HomeyDashDbContext> options) : DbContext(options)
{
    public DbSet<Dashboard> Dashboards => Set<Dashboard>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<Dashboard>(dashboard =>
        {
            dashboard.Property(d => d.Name).HasMaxLength(DashboardValidator.MaxNameLength);
            // Layouts are immutable records that are replaced, never changed, so reference equality tracks them.
            dashboard.Property(d => d.Draft).HasConversion(
                layout => JsonSerializer.Serialize(layout, Dashboard.Json),
                json => JsonSerializer.Deserialize<DashboardLayout>(json, Dashboard.Json)!);
            dashboard.Property(d => d.Published).HasConversion(
                layout => layout == null ? null : JsonSerializer.Serialize(layout, Dashboard.Json),
                json => json == null ? null : JsonSerializer.Deserialize<DashboardLayout>(json, Dashboard.Json));
            dashboard.Ignore(d => d.HasUnpublishedChanges);
        });
    }
}

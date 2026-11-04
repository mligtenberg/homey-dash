using System.Text.Json;
using HomeyDash.Api.Accounts;
using HomeyDash.Api.Dashboards;
using HomeyDash.Api.Displays;
using HomeyDash.Api.Photos;
using HomeyDash.Api.Plex;
using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Data;

public class HomeyDashDbContext(DbContextOptions<HomeyDashDbContext> options) : DbContext(options)
{
    public DbSet<Dashboard> Dashboards => Set<Dashboard>();
    public DbSet<Display> Displays => Set<Display>();
    public DbSet<HomeyAccount> HomeyAccounts => Set<HomeyAccount>();
    public DbSet<ImmichAccount> ImmichAccounts => Set<ImmichAccount>();
    public DbSet<PlexAccount> PlexAccounts => Set<PlexAccount>();
    public DbSet<PhotoSet> PhotoSets => Set<PhotoSet>();

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

        model.Entity<Display>(display =>
        {
            display.Property(d => d.Name).HasMaxLength(Display.MaxNameLength);
            // Deleting a dashboard sends the displays showing it back to waiting.
            display.HasOne<Dashboard>().WithMany().HasForeignKey(d => d.DashboardId).OnDelete(DeleteBehavior.SetNull);
            display.HasIndex(d => d.ScreenId).IsUnique();
            display.HasMany(d => d.Others).WithOne().HasForeignKey(o => o.DisplayId).OnDelete(DeleteBehavior.Cascade);
            display.Navigation(d => d.Others).AutoInclude();
        });

        model.Entity<DisplayDashboard>(other =>
        {
            other.ToTable("DisplayDashboards");
            other.HasKey(o => new { o.DisplayId, o.DashboardId });
            other.HasOne<Dashboard>().WithMany().HasForeignKey(o => o.DashboardId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<HomeyAccount>(account => account.Property(a => a.Name).HasMaxLength(AccountEndpoints.MaxNameLength));
        model.Entity<ImmichAccount>(account =>
        {
            account.Property(a => a.Name).HasMaxLength(AccountEndpoints.MaxNameLength);
            // Replaced as a whole when Management looks again.
            account.Property(a => a.Partners).HasConversion(
                partners => JsonSerializer.Serialize(partners, Dashboard.Json),
                json => string.IsNullOrEmpty(json) ? new List<ImmichPartner>() : JsonSerializer.Deserialize<List<ImmichPartner>>(json, Dashboard.Json)!,
                new Microsoft.EntityFrameworkCore.ChangeTracking.ValueComparer<IReadOnlyList<ImmichPartner>>(
                    (a, b) => ReferenceEquals(a, b), partners => partners.Count, partners => partners));
        });
        model.Entity<PlexAccount>(account =>
        {
            account.Property(a => a.Name).HasMaxLength(AccountEndpoints.MaxNameLength);
            account.Ignore(a => a.Connection);
        });

        model.Entity<PhotoSet>(set =>
        {
            set.Property(s => s.Name).HasMaxLength(PhotoSet.MaxNameLength);
            set.Ignore(s => s.Target);
            // Photos are replaced as a whole on a sync, never changed one by one.
            set.Property(s => s.Photos).HasConversion(
                photos => JsonSerializer.Serialize(photos, Dashboard.Json),
                json => JsonSerializer.Deserialize<List<Photo>>(json, Dashboard.Json)!,
                new Microsoft.EntityFrameworkCore.ChangeTracking.ValueComparer<IReadOnlyList<Photo>>(
                    (a, b) => ReferenceEquals(a, b), photos => photos.Count, photos => photos));
            set.Property(s => s.Selection).HasConversion(
                selection => selection == null ? null : JsonSerializer.Serialize(selection, Dashboard.Json),
                json => json == null ? null : JsonSerializer.Deserialize<PhotoSelection>(json, Dashboard.Json),
                new Microsoft.EntityFrameworkCore.ChangeTracking.ValueComparer<PhotoSelection?>(
                    (a, b) => ReferenceEquals(a, b), selection => selection == null ? 0 : selection.Count, selection => selection));
        });
    }
}

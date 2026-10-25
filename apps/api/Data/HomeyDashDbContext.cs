using Microsoft.EntityFrameworkCore;

namespace HomeyDash.Api.Data;

public class HomeyDashDbContext(DbContextOptions<HomeyDashDbContext> options) : DbContext(options)
{
    public DbSet<Tile> Tiles => Set<Tile>();
}

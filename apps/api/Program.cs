using HomeyDash.Api.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddDbContext<HomeyDashDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("HomeyDash")));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>().Database.Migrate();
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

var api = app.MapGroup("/api");

api.MapGet("/health", () => Results.Ok(new { status = "ok" }));

api.MapGet("/tiles", async (HomeyDashDbContext db) =>
    await db.Tiles.OrderBy(t => t.SortOrder).ToListAsync());

api.MapPost("/tiles", async (Tile tile, HomeyDashDbContext db) =>
{
    db.Tiles.Add(tile);
    await db.SaveChangesAsync();
    return Results.Created($"/api/tiles/{tile.Id}", tile);
});

api.MapDelete("/tiles/{id:int}", async (int id, HomeyDashDbContext db) =>
    await db.Tiles.Where(t => t.Id == id).ExecuteDeleteAsync() > 0
        ? Results.NoContent()
        : Results.NotFound());

app.Run();

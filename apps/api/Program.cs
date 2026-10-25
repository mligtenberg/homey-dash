using System.Text.Json;
using System.Text.Json.Serialization;
using HomeyDash.Api.Dashboards;
using HomeyDash.Api.Data;
using HomeyDash.Api.Displays;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Realtime;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));
builder.Services.AddDbContext<HomeyDashDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("HomeyDash")));
builder.Services.AddHomey(builder.Configuration);
builder.Services.AddRealtime();

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
api.MapHomey();
api.MapDashboards();
api.MapDisplays();
app.MapHub<RealtimeHub>(RealtimeHub.Path);

app.Run();

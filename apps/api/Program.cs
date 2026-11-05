using System.Text.Json;
using System.Text.Json.Serialization;
using HomeyDash.Api.Accounts;
using HomeyDash.Api.Dashboards;
using HomeyDash.Api.Data;
using HomeyDash.Api.Displays;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Mcp;
using HomeyDash.Api.Photos;
using HomeyDash.Api.Plex;
using HomeyDash.Api.Realtime;
using HomeyDash.Api.Rules;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));
builder.Services.AddDbContext<HomeyDashDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("HomeyDash")));
builder.Services.AddHomey(builder.Configuration);
builder.Services.AddPhotos(builder.Configuration);
builder.Services.AddPlex(builder.Configuration);
builder.Services.AddRules();
builder.Services.AddSingleton<TargetCatalog>();
builder.Services.AddRealtime();
builder.Services.AddMcpServer()
    .WithHttpTransport(options => options.Stateless = true)
    .WithTools<ManagementTools>(ManagementTools.Json);
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>().Database.Migrate();
    scope.ServiceProvider.LoadAccounts();
    scope.ServiceProvider.LoadPhotoSets();
    scope.ServiceProvider.LoadPlex();
    await scope.ServiceProvider.GetRequiredService<DisplayDirectory>()
        .RefreshAsync(scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>(), CancellationToken.None);
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

var api = app.MapGroup("/api");

api.MapGet("/health", () => Results.Ok(new { status = "ok" }));
api.MapHomey();
api.MapAccounts();
api.MapPhotos();
api.MapPlex();
api.MapDashboards();
api.MapBackgrounds();
api.MapPresetBackgrounds();
api.MapDisplays();
api.MapRules();
app.MapHub<RealtimeHub>(RealtimeHub.Path);
app.MapMcp(ManagementTools.Path);
// Everything outside /api and /mcp is a frontend: Management under /admin, the display app at the root.
app.MapReverseProxy();

app.Run();

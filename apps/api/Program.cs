using System.Text.Json;
using System.Text.Json.Serialization;
using HomeyDash.Api;
using HomeyDash.Api.Accounts;
using HomeyDash.Api.AirPlay;
using HomeyDash.Api.Dashboards;
using HomeyDash.Api.Data;
using HomeyDash.Api.Displays;
using HomeyDash.Api.Homey;
using HomeyDash.Api.Mcp;
using HomeyDash.Api.Photos;
using HomeyDash.Api.Plex;
using HomeyDash.Api.Realtime;
using HomeyDash.Api.Rules;
using HomeyDash.Api.Traffic;
using HomeyDash.Api.Weather;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));
builder.Services.AddDbContext<HomeyDashDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("HomeyDash")));
builder.Services.AddHomey(builder.Configuration);
builder.Services.AddPhotos(builder.Configuration);
builder.Services.AddPlex(builder.Configuration);
builder.Services.AddAirPlay(builder.Configuration);
builder.Services.AddWeather(builder.Configuration);
builder.Services.AddTraffic(builder.Configuration);
builder.Services.AddRules();
builder.Services.AddSingleton<TargetCatalog>();
builder.Services.AddRealtime();
builder.Services.AddMcpServer()
    .WithHttpTransport(options => options.Stateless = true)
    .WithTools<ManagementTools>(ManagementTools.Json);
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

// Optional HTTPS without a proxy: with SelfSignedCertificatePath set, every https endpoint
// (e.g. ASPNETCORE_HTTPS_PORTS=8443) uses a self-signed certificate created on first boot.
var certificatePath = builder.Configuration["SelfSignedCertificatePath"];
if (!string.IsNullOrWhiteSpace(certificatePath))
{
    var certificate = SelfSignedCertificate.LoadOrCreate(
        certificatePath,
        (builder.Configuration["SelfSignedCertificateHosts"] ?? "").Split(','));
    builder.WebHost.ConfigureKestrel(kestrel =>
        kestrel.ConfigureHttpsDefaults(https => https.ServerCertificate = certificate));
}

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>().Database.Migrate();
    scope.ServiceProvider.LoadAccounts();
    scope.ServiceProvider.LoadPhotoSets();
    scope.ServiceProvider.LoadPlex();
    scope.ServiceProvider.LoadTraffic();
    await scope.ServiceProvider.GetRequiredService<DisplayDirectory>()
        .RefreshAsync(scope.ServiceProvider.GetRequiredService<HomeyDashDbContext>(), CancellationToken.None);
}

// Static files must run before routing: once routing has picked the catch-all fallback endpoint,
// the static file middleware steps aside and every asset would come back as index.html.
string? frontends = Path.Combine(app.Environment.ContentRootPath, "frontends");
if (Directory.Exists(frontends))
{
    var admin = new PhysicalFileProvider(Path.Combine(frontends, "admin"));
    app.Map("/admin", branch =>
    {
        branch.UseStaticFiles(new StaticFileOptions { FileProvider = admin });
        branch.Run(context =>
        {
            context.Response.ContentType = "text/html";
            return context.Response.SendFileAsync(admin.GetFileInfo("index.html"));
        });
    });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(Path.Combine(frontends, "display")) });
}
else
{
    frontends = null;
}
app.UseRouting();

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
api.MapAirPlay();
api.MapWeather();
api.MapTraffic();
api.MapDashboards();
api.MapBackgrounds();
api.MapPresetBackgrounds();
api.MapDisplays();
api.MapRules();
app.MapHub<RealtimeHub>(RealtimeHub.Path);
app.MapMcp(ManagementTools.Path);
// Everything outside /api and /mcp is a frontend: Management under /admin, the display app at the root.
// In the container the built frontends sit next to the API and are served from disk;
// otherwise (development) the requests are forwarded to the frontend dev servers.
if (frontends is null)
{
    app.MapReverseProxy();
}
else
{
    var display = new PhysicalFileProvider(Path.Combine(frontends, "display"));
    Task Index(HttpContext context)
    {
        context.Response.ContentType = "text/html";
        return context.Response.SendFileAsync(display.GetFileInfo("index.html"));
    }
    app.MapGet("/", Index);
    app.MapFallback("{*path:regex(^(?!api/|mcp).*$)}", Index);
}

app.Run();

using System.Text.Json;
using System.Text.Json.Serialization;
using HomeyDash.Api.Data;
using HomeyDash.Api.Homey;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));
builder.Services.AddDbContext<HomeyDashDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("HomeyDash")));
builder.Services.AddHomey(builder.Configuration);

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

app.Run();

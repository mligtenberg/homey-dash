using System.Net;
using System.Text.Json;
using HomeyDash.Api.Homey;
using Microsoft.Extensions.Logging.Abstractions;

namespace HomeyDash.Api.Tests.Homey;

public sealed class AppCatalogTests
{
    private sealed class Handler(Func<string, HttpResponseMessage> answer) : HttpMessageHandler
    {
        public List<string> Asked { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            lock (Asked) Asked.Add(request.RequestUri!.PathAndQuery);
            return Task.FromResult(answer(request.RequestUri!.Query));
        }
    }

    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private static HttpResponseMessage Json(string json) => new(HttpStatusCode.OK) { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") };

    private static DeviceApp App(string name, string? id) =>
        new(name, null, JsonSerializer.SerializeToElement(id is null ? new { name } : (object)new { name, id }));

    [Fact]
    public async Task AnApp_GetsItsCategoryAndIconFromTheStore()
    {
        var handler = new Handler(_ => Json("""{"resultCount":1,"results":[{"primaryGenreName":"Entertainment","genres":["Amusement","Lifestyle"],"artworkUrl100":"https://cdn/x/100x100bb.jpg"}]}"""));
        var catalog = new AppCatalog(new Factory(handler), NullLogger<AppCatalog>.Instance);

        var apps = await catalog.DescribeAsync([App("Plex", "com.plexapp.plex")], CancellationToken.None);

        Assert.Equal("Amusement", apps[0].Category);
        Assert.True(apps[0].Media);
        Assert.Equal("https://cdn/x/200x200bb.jpg", apps[0].Image);
        Assert.Contains("bundleId=com.plexapp.plex", Assert.Single(handler.Asked));
    }

    [Fact]
    public async Task WhatWasFound_IsAskedForOnce_AndAnAppleAppIsCalledApple()
    {
        var handler = new Handler(_ => Json("""{"resultCount":0,"results":[]}"""));
        var catalog = new AppCatalog(new Factory(handler), NullLogger<AppCatalog>.Instance);

        await catalog.DescribeAsync([App("Music", "com.apple.TVMusic")], CancellationToken.None);
        var apps = await catalog.DescribeAsync([App("Music", "com.apple.TVMusic"), App("Unknown", "com.example.none")], CancellationToken.None);

        Assert.Equal(["Apple", null], apps.Select(a => a.Category));
        Assert.Equal(2, handler.Asked.Count);
    }

    [Fact]
    public async Task AnAppWithoutABundleId_IsNotLookedUp_AndAFailedLookupLeavesTheAppAsItIs()
    {
        var handler = new Handler(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError));
        var catalog = new AppCatalog(new Factory(handler), NullLogger<AppCatalog>.Instance);

        var apps = await catalog.DescribeAsync([App("Netflix", null), App("Plex", "com.plexapp.plex")], CancellationToken.None);

        Assert.All(apps, a => Assert.Null(a.Category));
        Assert.Single(handler.Asked);
    }
}

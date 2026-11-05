using System.Net;
using HomeyDash.Api.Dashboards;
using SkiaSharp;

namespace HomeyDash.Api.Tests.Dashboards;

public class PresetBackgroundTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task ABuiltInBackground_IsRenderedAsAWebPOfTheScreensSize()
    {
        var response = await _client.GetAsync("/api/backgrounds/presets/flat/garden-day.webp?width=320&height=480");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/webp", response.Content.Headers.ContentType?.MediaType);
        using var image = SKBitmap.Decode(await response.Content.ReadAsByteArrayAsync());
        Assert.Equal((320, 480), (image.Width, image.Height));
    }

    [Fact]
    public async Task ABuiltInBackground_IsRenderedInItsColourScheme()
    {
        var plain = await _client.GetByteArrayAsync("/api/backgrounds/presets/flat/garden-day.webp?width=64&height=40");
        var schemed = await _client.GetByteArrayAsync("/api/backgrounds/presets/flat/garden-day.webp?width=64&height=40&color=%23d04040&angle=30");

        Assert.NotEqual(plain, schemed);
    }

    [Theory]
    [InlineData("nope/garden-day.webp?width=64&height=40", HttpStatusCode.NotFound)]
    [InlineData("flat/garden-dusk.webp?width=64&height=40", HttpStatusCode.NotFound)]
    [InlineData("flat/garden-day.webp?width=0&height=40", HttpStatusCode.BadRequest)]
    [InlineData("flat/garden-day.webp?width=64", HttpStatusCode.BadRequest)]
    [InlineData("flat/garden-day.webp?width=64&height=40&color=%23d04040", HttpStatusCode.BadRequest)]
    [InlineData("flat/garden-day.webp?width=64&height=40&color=red&angle=30", HttpStatusCode.BadRequest)]
    public async Task ARenderedBackground_NeedsAKnownImageASizeAndAWholeScheme(string path, HttpStatusCode expected)
    {
        var response = await _client.GetAsync($"/api/backgrounds/presets/{path}");

        Assert.Equal(expected, response.StatusCode);
    }

    private const string Svg =
        "<svg><style>@supports (color: oklch(from red l c h)){svg{}" +
        ".day-k0{fill:oklch(from #c6ccd5 l max(c,calc(var(--scheme-chroma,0)*.65)) var(--scheme-h2,h))}}</style>" +
        "<rect fill=\"#c6ccd5\" class=\"day-k0\"/><rect fill=\"#123456\"/></svg>";

    [Fact]
    public void Recolouring_GivesAColourItsRolesHueAndKeepsItsLightness()
    {
        var svg = PresetBackgrounds.Recolor(Svg, new ColorScheme("#0000ff", 30));

        var to = System.Text.RegularExpressions.Regex.Match(svg, "fill=\"(#[0-9a-f]{6})\"").Groups[1].Value;
        var (l, c, h) = Oklch.FromHex(to);
        Assert.Equal(Oklch.FromHex("#c6ccd5").L, l, 2);
        // Opposite the picked blue's hue (264°), and at least .65 of its chroma, as far as sRGB allows.
        Assert.Equal((Oklch.FromHex("#0000ff").H + 180) % 360, h, 0);
        Assert.True(c > 0.1);
        Assert.Contains("fill=\"#123456\"", svg);
        Assert.DoesNotContain("<style>", svg);
    }

    [Fact]
    public void WithoutAScheme_AnImageKeepsItsColours()
    {
        Assert.Equal("<svg><rect fill=\"#c6ccd5\" class=\"day-k0\"/><rect fill=\"#123456\"/></svg>", PresetBackgrounds.Recolor(Svg, null));
    }

    [Theory]
    [InlineData("#3366cc")]
    [InlineData("#d9a066")]
    [InlineData("#1a1c24")]
    [InlineData("#ffffff")]
    public void Oklch_GoesThereAndBack(string hex)
    {
        var (l, c, h) = Oklch.FromHex(hex);
        Assert.Equal(hex, Oklch.ToHex(l, c, h));
    }
}

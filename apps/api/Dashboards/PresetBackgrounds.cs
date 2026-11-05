using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;
using SkiaSharp;
using Svg.Skia;

namespace HomeyDash.Api.Dashboards;

/// <summary>
/// HomeyDash's built-in backgrounds (libs/design-system/backgrounds, copied next to the API), rendered for a display as
/// a WebP of its screen's size, in the background's colour scheme when it has one. Displays don't draw the SVGs
/// themselves: large ones are slow on a wall tablet, and the scheme is applied with CSS relative colours not all of them
/// know.
/// </summary>
public static partial class PresetBackgrounds
{
    public const int MaxSide = 4096;

    private static readonly string Folder = Path.Combine(AppContext.BaseDirectory, "backgrounds");

    // Rendered images, by what they were rendered from: displays ask again on every start.
    private static readonly MemoryCache Rendered = new(new MemoryCacheOptions { SizeLimit = 64 * 1024 * 1024 });

    public static void MapPresetBackgrounds(this RouteGroupBuilder api)
    {
        // /api/backgrounds/presets/flat/garden-day.webp?width=1280&height=800&color=%233d7ae0&angle=30
        api.MapGet("/backgrounds/presets/{style}/{name}.webp",
            (string style, string name, int? width, int? height, string? color, int? angle, HttpContext http) =>
            {
                if (!Name().IsMatch(style) || !File().IsMatch(name)) return Results.NotFound();
                var path = Path.Combine(Folder, style, $"{name}.svg");
                if (!System.IO.File.Exists(path)) return Results.NotFound();
                var errors = new Dictionary<string, string[]>();
                if (width is not (>= 1 and <= MaxSide)) errors["width"] = [$"A width is 1 to {MaxSide} pixels."];
                if (height is not (>= 1 and <= MaxSide)) errors["height"] = [$"A height is 1 to {MaxSide} pixels."];
                if (color is not null || angle is not null)
                {
                    if (color is null || !HexColor().IsMatch(color)) errors["color"] = ["A colour is written as #rrggbb."];
                    if (angle is not (>= 0 and < 360)) errors["angle"] = ["The angle to the second colour is 0 to 359 degrees."];
                }
                if (errors.Count > 0) return Results.ValidationProblem(errors);

                var scheme = color is null ? null : new ColorScheme(color, angle!.Value);
                var webp = Rendered.GetOrCreate((path, width, height, color, angle), entry =>
                {
                    var bytes = Render(System.IO.File.ReadAllText(path), scheme, width!.Value, height!.Value);
                    entry.Size = bytes.Length;
                    entry.SlidingExpiration = TimeSpan.FromHours(6);
                    return bytes;
                })!;
                // Not immutable: the images change when they are generated again.
                http.Response.Headers.CacheControl = "public, max-age=86400";
                return Results.Bytes(webp, "image/webp");
            });
    }

    /// <summary>A built-in image's SVG, recoloured, drawn to cover width × height as preserveAspectRatio slice does.</summary>
    public static byte[] Render(string svg, ColorScheme? scheme, int width, int height)
    {
        using var image = SKSvg.CreateFromSvg(Recolor(svg, scheme));
        var picture = image.Picture ?? throw new InvalidOperationException("The SVG has nothing to draw.");
        var bounds = picture.CullRect;
        using var surface = SKSurface.Create(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
        var canvas = surface.Canvas;
        var scale = Math.Max(width / bounds.Width, height / bounds.Height);
        canvas.Translate(width / 2f, height / 2f);
        canvas.Scale(scale);
        canvas.Translate(-bounds.MidX, -bounds.MidY);
        canvas.DrawPicture(picture);
        using var snapshot = surface.Snapshot();
        using var data = snapshot.Encode(SKEncodedImageFormat.Webp, 85);
        return data.ToArray();
    }

    /// <summary>
    /// Resolves the colour scheme the way the image's own CSS does in a browser (see generate.mjs): every colour keeps
    /// its oklch lightness, takes at least its role's share of the picked colour's chroma and takes its role's hue. The
    /// CSS is left out, as the renderer doesn't know relative colours; without a scheme the image keeps its colours.
    /// </summary>
    public static string Recolor(string svg, ColorScheme? scheme)
    {
        var colors = new Dictionary<string, string>();
        if (scheme is not null)
        {
            var (_, chroma, hue) = Oklch.FromHex(scheme.Color);
            double[] hues = [hue, hue + scheme.Angle, hue + 180, hue + scheme.Angle + 180];
            foreach (Match rule in SchemeRule().Matches(svg))
            {
                var (from, share, role) = (rule.Groups["from"].Value, double.Parse(rule.Groups["share"].Value, CultureInfo.InvariantCulture),
                    int.Parse(rule.Groups["hue"].Value, CultureInfo.InvariantCulture));
                var (l, c, _) = Oklch.FromHex(from);
                colors[$"{rule.Groups["prop"].Value}=\"{from}\""] = Oklch.ToHex(l, Math.Max(c, chroma * share), hues[role] % 360);
            }
        }
        var plain = Style().Replace(svg, "");
        return colors.Count == 0 ? plain : ColorAttribute().Replace(plain, m => colors.TryGetValue(m.Value, out var to)
            ? $"{m.Groups["prop"].Value}=\"{to}\""
            : m.Value);
    }

    [GeneratedRegex("^[a-z0-9-]+$")]
    private static partial Regex Name();

    [GeneratedRegex("^[a-z0-9-]+-(day|night)$")]
    private static partial Regex File();

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColor();

    [GeneratedRegex(@"<style>.*?</style>", RegexOptions.Singleline)]
    private static partial Regex Style();

    [GeneratedRegex(@"\.[\w-]+\{(?<prop>fill|stroke|stop-color):oklch\(from (?<from>#[0-9a-f]{6}) l max\(c,calc\(var\(--scheme-chroma,0\)\*(?<share>[\d.]+)\)\) var\(--scheme-h(?<hue>[0-3]),h\)\)\}")]
    private static partial Regex SchemeRule();

    [GeneratedRegex(@"(?<prop>fill|stroke|stop-color)=""#[0-9a-f]{6}""")]
    private static partial Regex ColorAttribute();
}

/// <summary>A built-in background's colour scheme: a picked colour, and the angle to the second around the hue wheel.</summary>
public sealed record ColorScheme(string Color, int Angle);

/// <summary>oklch, as CSS has it; mirrors libs/tiles/src/lib/background-colors.ts.</summary>
public static class Oklch
{
    public static (double L, double C, double H) FromHex(string hex)
    {
        var (r, g, b) = (Linear(hex, 1), Linear(hex, 3), Linear(hex, 5));
        var l = Math.Cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        var m = Math.Cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        var s = Math.Cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        var L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
        var A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
        var B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
        return (L, Math.Sqrt(A * A + B * B), (Math.Atan2(B, A) * 180 / Math.PI + 360) % 360);
    }

    /// <summary>As #rrggbb, with chroma lowered until it fits, keeping its hue and lightness.</summary>
    public static string ToHex(double l, double c, double h)
    {
        bool Fits(double chroma) => Rgb(l, chroma, h).All(v => v is >= -0.0005 and <= 1.0005);
        var (low, high) = (0.0, c);
        if (!Fits(c))
            for (var i = 0; i < 20; i++)
                if (Fits((low + high) / 2)) low = (low + high) / 2; else high = (low + high) / 2;
        return "#" + string.Concat(Rgb(l, Fits(c) ? c : low, h).Select(v => ((int)Math.Round(Math.Clamp(v, 0, 1) * 255)).ToString("x2")));
    }

    private static double Linear(string hex, int at)
    {
        var v = Convert.ToInt32(hex.Substring(at, 2), 16) / 255.0;
        return v <= 0.04045 ? v / 12.92 : Math.Pow((v + 0.055) / 1.055, 2.4);
    }

    private static double[] Rgb(double L, double C, double H)
    {
        var (A, B) = (C * Math.Cos(H * Math.PI / 180), C * Math.Sin(H * Math.PI / 180));
        var l = Math.Pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
        var m = Math.Pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
        var s = Math.Pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
        return new[]
        {
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        }.Select(v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.Pow(v, 1 / 2.4) - 0.055).ToArray();
    }
}

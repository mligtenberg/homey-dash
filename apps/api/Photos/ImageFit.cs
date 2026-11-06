using SkiaSharp;
using Svg.Skia;

namespace HomeyDash.Api.Photos;

/// <summary>
/// Photos and backgrounds as a display wants them: cropped to cover a box of its screen's size, around the faces in the
/// photo when it has some, and scaled down to it. A wall tablet decodes and scales far less than the original or Immich's
/// preview, which are larger than its screen.
/// </summary>
public static class ImageFit
{
    public const int MaxSide = 4096;

    /// <summary>Why a size can't be used, as validation errors; none when both are 1 to <see cref="MaxSide"/> or both are left out.</summary>
    public static Dictionary<string, string[]> Check(int? width, int? height)
    {
        var errors = new Dictionary<string, string[]>();
        if (width is null && height is null) return errors;
        if (width is not (>= 1 and <= MaxSide)) errors["width"] = [$"A width is 1 to {MaxSide} pixels, and sent together with a height."];
        if (height is not (>= 1 and <= MaxSide)) errors["height"] = [$"A height is 1 to {MaxSide} pixels, and sent together with a width."];
        return errors;
    }

    /// <summary>
    /// The crop of a width × height image that covers a box of the ratio boxWidth : boxHeight with the focus in its
    /// middle as far as the image's edges allow, in pixels of the image.
    /// </summary>
    public static SKRectI Crop(int width, int height, double boxWidth, double boxHeight, Focus focus)
    {
        var (cropWidth, cropHeight) = (width, height);
        if ((double)width / height > boxWidth / boxHeight) cropWidth = Math.Min(width, (int)Math.Round(height * boxWidth / boxHeight));
        else cropHeight = Math.Min(height, (int)Math.Round(width * boxHeight / boxWidth));
        var left = (int)Math.Round(Math.Clamp(focus.X * width - cropWidth / 2.0, 0, width - cropWidth));
        var top = (int)Math.Round(Math.Clamp(focus.Y * height - cropHeight / 2.0, 0, height - cropHeight));
        return SKRectI.Create(left, top, cropWidth, cropHeight);
    }

    /// <summary>
    /// The image covering width × height pixels as a WebP, or null when it isn't an image (a photo or an SVG, which the fake
    /// Immich sends). An image smaller than the box is only cropped, not enlarged.
    /// </summary>
    public static byte[]? Cover(Stream content, int width, int height, Focus focus)
    {
        using var bitmap = Decode(content, width, height, focus);
        if (bitmap is null) return null;
        var crop = Crop(bitmap.Width, bitmap.Height, width, height, focus);
        var scale = Math.Min(1.0, Math.Max((double)width / crop.Width, (double)height / crop.Height));
        var target = new SKImageInfo(Math.Max(1, (int)Math.Round(crop.Width * scale)), Math.Max(1, (int)Math.Round(crop.Height * scale)));
        using var fitted = new SKBitmap(target);
        using var source = new SKBitmap();
        if (!bitmap.ExtractSubset(source, crop)) return null;
        if (!source.ScalePixels(fitted, new SKSamplingOptions(SKCubicResampler.Mitchell))) return null;
        using var image = SKImage.FromBitmap(fitted);
        using var data = image.Encode(SKEncodedImageFormat.Webp, 85);
        return data.ToArray();
    }

    // The fake Immich's photos are SVGs; drawn at their own size.
    private static SKBitmap? DrawSvg(Stream content)
    {
        try
        {
            using var svg = new SKSvg();
            if (svg.Load(content) is not { } picture) return null;
            var bounds = picture.CullRect;
            var bitmap = new SKBitmap(Math.Max(1, (int)Math.Ceiling(bounds.Width)), Math.Max(1, (int)Math.Ceiling(bounds.Height)));
            using var canvas = new SKCanvas(bitmap);
            canvas.Translate(-bounds.Left, -bounds.Top);
            canvas.DrawPicture(picture);
            return bitmap;
        }
        catch (Exception e) when (e is InvalidOperationException or System.Xml.XmlException or ArgumentException)
        {
            return null;
        }
    }

    // Upright, as a browser shows it: turned as the file's EXIF orientation says. Decoded no larger than the box needs
    // (JPEG and WebP decode at 1/2, 1/4, 1/8 size directly), so a 12 MP photo for a tablet never fills memory in full.
    private static SKBitmap? Decode(Stream content, int width, int height, Focus focus)
    {
        using var data = SKData.Create(content);
        using var codec = data is null ? null : SKCodec.Create(data);
        if (codec is null)
        {
            if (data is null) return null;
            using var raw = data.AsStream();
            return DrawSvg(raw);
        }
        var (turn, flip) = codec.EncodedOrigin switch
        {
            SKEncodedOrigin.RightTop => (90f, false),
            SKEncodedOrigin.BottomRight => (180f, false),
            SKEncodedOrigin.LeftBottom => (270f, false),
            SKEncodedOrigin.TopRight => (0f, true),
            SKEncodedOrigin.BottomLeft => (180f, true),
            SKEncodedOrigin.LeftTop => (90f, true),
            SKEncodedOrigin.RightBottom => (270f, true),
            _ => (0f, false),
        };
        var sideways = turn is 90 or 270;
        var (uprightWidth, uprightHeight) = sideways ? (codec.Info.Height, codec.Info.Width) : (codec.Info.Width, codec.Info.Height);
        var crop = Crop(uprightWidth, uprightHeight, width, height, focus);
        var wanted = (float)Math.Min(1.0, Math.Max((double)width / crop.Width, (double)height / crop.Height));
        using var decoded = SKBitmap.Decode(codec, codec.Info.WithSize(codec.GetScaledDimensions(wanted)));
        if (decoded is null) return null;
        if (turn == 0 && !flip) return decoded.Copy();
        var upright = new SKBitmap(sideways ? decoded.Height : decoded.Width, sideways ? decoded.Width : decoded.Height);
        using var canvas = new SKCanvas(upright);
        canvas.Translate(upright.Width / 2f, upright.Height / 2f);
        canvas.RotateDegrees(turn);
        if (flip) canvas.Scale(-1, 1);
        canvas.Translate(-decoded.Width / 2f, -decoded.Height / 2f);
        using var image = SKImage.FromBitmap(decoded);
        canvas.DrawImage(image, 0, 0, new SKSamplingOptions());
        return upright;
    }
}

using HomeyDash.Api.Photos;
using SkiaSharp;

namespace HomeyDash.Api.Tests.Photos;

public class ImageFitTests
{
    [Fact]
    public void Crops_a_wide_photo_to_a_tall_box_around_the_faces()
    {
        // 4:3 photo, 1:1 box: the full height, 1200 wide, with the face (at 80%) as near the middle as the edge allows.
        Assert.Equal(SKRectI.Create(400, 0, 1200, 1200), ImageFit.Crop(1600, 1200, 1, 1, new Focus(.8, .5)));
        Assert.Equal(SKRectI.Create(0, 0, 1200, 1200), ImageFit.Crop(1600, 1200, 1, 1, new Focus(.1, .5)));
        Assert.Equal(SKRectI.Create(200, 0, 1200, 1200), ImageFit.Crop(1600, 1200, 1, 1, Focus.Middle));
    }

    [Fact]
    public void Crops_a_tall_photo_to_a_wide_box_around_the_faces()
    {
        Assert.Equal(SKRectI.Create(0, 0, 900, 450), ImageFit.Crop(900, 1200, 2, 1, new Focus(.5, .1)));
        Assert.Equal(SKRectI.Create(0, 750, 900, 450), ImageFit.Crop(900, 1200, 2, 1, new Focus(.5, .95)));
    }

    [Fact]
    public void Keeps_the_photo_whole_for_a_box_of_its_ratio()
    {
        Assert.Equal(SKRectI.Create(0, 0, 1600, 1200), ImageFit.Crop(1600, 1200, 4, 3, new Focus(.9, .9)));
    }

    [Fact]
    public void Covers_the_box_with_a_webp_of_its_size()
    {
        var fitted = ImageFit.Cover(new MemoryStream(Jpeg(1600, 1200)), 400, 200, new Focus(.5, .5));

        Assert.NotNull(fitted);
        using var image = SKBitmap.Decode(fitted);
        Assert.Equal((400, 200), (image.Width, image.Height));
    }

    [Fact]
    public void Does_not_enlarge_a_photo_that_is_smaller_than_the_box()
    {
        using var image = SKBitmap.Decode(ImageFit.Cover(new MemoryStream(Jpeg(160, 120)), 800, 800, Focus.Middle)!);

        Assert.Equal((120, 120), (image.Width, image.Height));
    }

    [Fact]
    public void Draws_an_svg_as_a_webp_too()
    {
        var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"160\" height=\"120\"><rect width=\"160\" height=\"120\" fill=\"red\"/></svg>"u8.ToArray();

        using var image = SKBitmap.Decode(ImageFit.Cover(new MemoryStream(svg), 80, 80, Focus.Middle)!);

        Assert.Equal((80, 80), (image.Width, image.Height));
    }

    [Fact]
    public void Gives_up_on_what_is_no_image()
    {
        Assert.Null(ImageFit.Cover(new MemoryStream("not an image"u8.ToArray()), 100, 100, Focus.Middle));
    }
    [Fact]
    public void Asks_for_both_sides_or_none()
    {
        Assert.Empty(ImageFit.Check(null, null));
        Assert.Empty(ImageFit.Check(1280, 800));
        Assert.Contains("height", ImageFit.Check(1280, null).Keys);
        Assert.Contains("width", ImageFit.Check(0, 800).Keys);
        Assert.Contains("width", ImageFit.Check(ImageFit.MaxSide + 1, 800).Keys);
    }

    private static byte[] Jpeg(int width, int height)
    {
        using var bitmap = new SKBitmap(width, height);
        bitmap.Erase(SKColors.SteelBlue);
        using var image = SKImage.FromBitmap(bitmap);
        return image.Encode(SKEncodedImageFormat.Jpeg, 90).ToArray();
    }
}

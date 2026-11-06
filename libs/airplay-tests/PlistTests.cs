using HomeyDash.AirPlay.Protocol;

namespace HomeyDash.AirPlay.Tests;

public class PlistTests
{
    [Fact]
    public void ReadsWhatPythonsPlistlibWrote()
    {
        var plist = BinaryPlist.ReadDictionary(Convert.FromHexString(Vectors.Plist));

        Assert.Equal(53112L, plist["eventPort"]);
        Assert.Equal("Living room", plist["name"]);
        Assert.Equal("Café ☕", plist["unicode"]);
        Assert.Equal(1.5, plist["ratio"]);
        Assert.Equal(true, plist["yes"]);
        Assert.Equal(false, plist["no"]);
        Assert.Equal(-7L, plist["negative"]);
        Assert.Equal(1L << 40, plist["big"]);
        Assert.Equal(Enumerable.Range(0, 20).Select(i => (byte)i).ToArray(), plist["blob"]);
        var streams = Assert.IsType<List<object?>>(plist["streams"]);
        Assert.Equal(3L, ((Dictionary<string, object?>)streams[0]!)["streamID"]);
        Assert.Equal("x", streams[1]);
    }

    [Fact]
    public void WritesWhatItReadsBack()
    {
        var original = new Dictionary<string, object?>
        {
            ["text"] = "Café",
            ["long"] = new string('a', 300),
            ["small"] = 7,
            ["medium"] = 70000,
            ["negative"] = -3,
            ["real"] = 0.25,
            ["flag"] = true,
            ["data"] = new byte[40],
            ["list"] = new List<object?> { "a", 1, new Dictionary<string, object?> { ["k"] = false } },
        };

        var read = BinaryPlist.ReadDictionary(BinaryPlist.Write(original));

        Assert.Equal("Café", read["text"]);
        Assert.Equal(300, ((string)read["long"]!).Length);
        Assert.Equal(7L, read["small"]);
        Assert.Equal(70000L, read["medium"]);
        Assert.Equal(-3L, read["negative"]);
        Assert.Equal(0.25, read["real"]);
        Assert.Equal(true, read["flag"]);
        Assert.Equal(40, ((byte[])read["data"]!).Length);
        var list = Assert.IsType<List<object?>>(read["list"]);
        Assert.Equal("a", list[0]);
        Assert.Equal(false, ((Dictionary<string, object?>)list[2]!)["k"]);
    }

    [Fact]
    public void RefusesSomethingThatIsNotAPlist() =>
        Assert.Throws<AirPlayException>(() => BinaryPlist.Read(new byte[100]));
}

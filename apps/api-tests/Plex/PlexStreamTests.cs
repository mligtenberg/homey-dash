using System.Net;
using HomeyDash.Api.Plex;

namespace HomeyDash.Api.Tests.Plex;

public sealed class PlexStreamTests
{
    private static readonly PlexConnection Local = new("http://192.168.1.23:32400", "tok", "client");

    private sealed class Handler(Func<HttpRequestMessage, HttpStatusCode> answer) : HttpMessageHandler
    {
        public List<string> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(request.RequestUri!.GetLeftPart(UriPartial.Path));
            return Task.FromResult(new HttpResponseMessage(answer(request)) { Content = new StringContent("{}") });
        }
    }

    [Fact]
    public void ATrackChoice_NamesTheStreamsAndWhereToStart()
    {
        var url = PlexStream.Url(Local, "5", "s1", choice: new PlexStreamChoice("22", null, 95));

        Assert.Contains("audioStreamID=22", url);
        Assert.Contains("subtitleStreamID=0", url);
        Assert.Contains("subtitles=none", url);
        Assert.Contains("offset=95", url);
        Assert.Contains("directStream=1", url);
    }

    [Fact]
    public void ASubtitle_IsBurnedIn_SoTheVideoIsNotCopied()
    {
        var url = PlexStream.Url(Local, "5", "s1", copyVideo: true, choice: new PlexStreamChoice(null, "31", 0));

        Assert.Contains("subtitleStreamID=31", url);
        Assert.Contains("subtitles=burn", url);
        Assert.Contains("directStream=0", url);
        Assert.DoesNotContain("audioStreamID", url);
        Assert.DoesNotContain("offset", url);
    }

    [Fact]
    public void WithoutAChoice_PlexPicksTheTracks()
    {
        var url = PlexStream.Url(Local, "5", "s1");

        Assert.DoesNotContain("audioStreamID", url);
        Assert.DoesNotContain("subtitle", url);
    }

    [Fact]
    public void TheStream_TranscodesAudioAlwaysAndCopiesVideoOnlyWhenAsked()
    {
        var copy = PlexStream.Url(Local, "5", "s1");
        var transcode = PlexStream.Url(Local, "5", "s1", copyVideo: false);

        Assert.Contains("directStreamAudio=0", copy);
        Assert.Contains("directStream=1", copy);
        Assert.Contains("directStream=0", transcode);
        Assert.Contains("session=s1", copy);
        Assert.Contains("X-Plex-Token=tok", copy);
    }

    [Theory]
    [InlineData("h264", true)]
    [InlineData("H264", true)]
    [InlineData("hevc", false)]
    [InlineData(null, false)]
    public void OnlyH264VideoIsCopied(string? codec, bool copied) =>
        Assert.Equal(copied, PlexStream.CanCopyVideo(new PlexSource(codec, "aac", "mp4")));

    [Fact]
    public async Task APlexDirectAddress_BecomesItsLocalIpOverHttp_WhenThatAnswers()
    {
        var server = new PlexConnection("https://192-168-1-23.4f8b9361c0204ddd9e0c52ad60791527.plex.direct:32400", "tok", "client");
        var handler = new Handler(_ => HttpStatusCode.OK);

        var receiver = await PlexStream.ForReceiverAsync(new HttpClient(handler), server, CancellationToken.None);

        Assert.Equal("http://192.168.1.23:32400", receiver.Uri);
        Assert.Equal(["http://192.168.1.23:32400/identity"], handler.Requests);
    }

    [Fact]
    public async Task APlexDirectAddress_StaysWhenItsIpDoesNotAnswer_AndOtherAddressesAreLeftAlone()
    {
        var direct = new PlexConnection("https://192-168-1-23.4f8b9361c0204ddd9e0c52ad60791527.plex.direct:32400", "tok", "client");
        var refused = new HttpClient(new Handler(_ => HttpStatusCode.Forbidden));
        var untouched = new Handler(_ => HttpStatusCode.OK);

        Assert.Equal(direct, await PlexStream.ForReceiverAsync(refused, direct, CancellationToken.None));
        Assert.Equal(Local, await PlexStream.ForReceiverAsync(new HttpClient(untouched), Local, CancellationToken.None));
        Assert.Empty(untouched.Requests);
    }
}

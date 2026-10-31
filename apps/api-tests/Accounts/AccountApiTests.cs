using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HomeyDash.Api.Accounts;

namespace HomeyDash.Api.Tests.Accounts;

public class AccountApiTests(RealHomeyApiFactory factory) : IClassFixture<RealHomeyApiFactory>
{
    // Nothing listens on the discard port, so connecting fails at once.
    private const string NoHomey = "127.0.0.1:9";

    private readonly HttpClient _client = factory.CreateClient();

    private async Task<JsonElement> HomeyAccountAsync() =>
        await _client.GetFromJsonAsync<JsonElement>("/api/accounts/homey");

    [Fact]
    public async Task WithoutAnAccount_HomeyIsNotSetUp()
    {
        await _client.DeleteAsync("/api/accounts/homey");

        var account = await HomeyAccountAsync();
        Assert.False(account.GetProperty("fake").GetBoolean());
        Assert.Equal(JsonValueKind.Null, account.GetProperty("address").ValueKind);
        await Eventually(async () =>
            (await _client.GetFromJsonAsync<JsonElement>("/api/homey/status")).GetProperty("connection").GetString() == "notSetUp");
    }

    [Fact]
    public async Task SettingUpHomey_KeepsTheKeyInTheBackend()
    {
        var response = await _client.PutAsJsonAsync("/api/accounts/homey", new { address = NoHomey, apiKey = "secret-key" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.DoesNotContain("secret-key", await response.Content.ReadAsStringAsync());
        Assert.Equal("http://127.0.0.1:9", (await HomeyAccountAsync()).GetProperty("address").GetString());
        Assert.DoesNotContain("secret-key", await _client.GetStringAsync("/api/accounts/homey"));
    }

    [Fact]
    public async Task ChangingTheAddress_KeepsTheKey()
    {
        await _client.PutAsJsonAsync("/api/accounts/homey", new { address = NoHomey, apiKey = "secret-key" });

        var response = await _client.PutAsJsonAsync("/api/accounts/homey", new { address = "127.0.0.2:9" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("http://127.0.0.2:9", (await HomeyAccountAsync()).GetProperty("address").GetString());
    }

    [Fact]
    public async Task ANewAccount_NeedsAnAddressAndAKey()
    {
        await _client.DeleteAsync("/api/accounts/homey");

        var response = await _client.PutAsJsonAsync("/api/accounts/homey", new { address = "not a url" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        Assert.True(errors.TryGetProperty("address", out _));
        Assert.True(errors.TryGetProperty("apiKey", out _));
    }

    [Fact]
    public async Task RemovingTheAccount_ForgetsIt()
    {
        await _client.PutAsJsonAsync("/api/accounts/homey", new { address = NoHomey, apiKey = "secret-key" });

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync("/api/accounts/homey")).StatusCode);

        Assert.Equal(JsonValueKind.Null, (await HomeyAccountAsync()).GetProperty("address").ValueKind);
    }

    [Theory]
    [InlineData("192.168.1.10", "http://192.168.1.10")]
    [InlineData(" homey-abc.local ", "http://homey-abc.local")]
    [InlineData("https://192.168.1.10:4859/", "https://192.168.1.10:4859")]
    [InlineData("ftp://192.168.1.10", null)]
    [InlineData("", null)]
    public void Addresses_AreAcceptedAsPeopleTypeThem(string typed, string? expected)
    {
        Assert.Equal(expected, AccountEndpoints.NormalizeAddress(typed));
    }

    private static async Task Eventually(Func<Task<bool>> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!await condition())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("Condition not met within 5 seconds");
            await Task.Delay(20);
        }
    }
}

public class FakeHomeyAccountApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task AFakeHomey_CannotBeReplacedByAnAccount()
    {
        Assert.True((await _client.GetFromJsonAsync<JsonElement>("/api/accounts/homey")).GetProperty("fake").GetBoolean());

        var response = await _client.PutAsJsonAsync("/api/accounts/homey", new { address = "192.168.1.10", apiKey = "key" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }
}

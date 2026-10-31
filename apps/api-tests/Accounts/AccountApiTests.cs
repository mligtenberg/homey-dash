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

    private async Task<JsonElement> HomeyAccountsAsync() =>
        (await _client.GetFromJsonAsync<JsonElement>("/api/accounts/homey")).GetProperty("accounts");

    private async Task RemoveAllAsync()
    {
        foreach (var account in (await HomeyAccountsAsync()).EnumerateArray())
            await _client.DeleteAsync($"/api/accounts/homey/{account.GetProperty("id").GetInt32()}");
    }

    private async Task<JsonElement> AddAsync(string name, string address = NoHomey, string apiKey = "secret-key")
    {
        var response = await _client.PostAsJsonAsync("/api/accounts/homey", new { name, address, apiKey });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accounts").EnumerateArray()
            .Single(a => a.GetProperty("name").GetString() == name);
    }

    [Fact]
    public async Task WithoutAnAccount_HomeyIsNotSetUp()
    {
        await RemoveAllAsync();

        var info = await _client.GetFromJsonAsync<JsonElement>("/api/accounts/homey");
        Assert.False(info.GetProperty("fake").GetBoolean());
        Assert.Equal(0, info.GetProperty("accounts").GetArrayLength());
        await Eventually(async () =>
            (await _client.GetFromJsonAsync<JsonElement>("/api/homey/status")).GetProperty("connection").GetString() == "notSetUp");
    }

    [Fact]
    public async Task AddingAHomey_KeepsTheKeyInTheBackend()
    {
        await RemoveAllAsync();

        var response = await _client.PostAsJsonAsync("/api/accounts/homey", new { name = "Home", address = NoHomey, apiKey = "secret-key" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.DoesNotContain("secret-key", await response.Content.ReadAsStringAsync());
        Assert.Equal("http://127.0.0.1:9", (await HomeyAccountsAsync())[0].GetProperty("address").GetString());
        Assert.DoesNotContain("secret-key", await _client.GetStringAsync("/api/accounts/homey"));
    }

    [Fact]
    public async Task ChangingTheAddress_KeepsTheKey()
    {
        await RemoveAllAsync();
        var id = (await AddAsync("Home")).GetProperty("id").GetInt32();

        var response = await _client.PutAsJsonAsync($"/api/accounts/homey/{id}", new { name = "Home", address = "127.0.0.2:9" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("http://127.0.0.2:9", (await HomeyAccountsAsync())[0].GetProperty("address").GetString());
    }

    [Fact]
    public async Task ANewAccount_NeedsANameAnAddressAndAKey()
    {
        var response = await _client.PostAsJsonAsync("/api/accounts/homey", new { address = "not a url" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        Assert.True(errors.TryGetProperty("name", out _));
        Assert.True(errors.TryGetProperty("address", out _));
        Assert.True(errors.TryGetProperty("apiKey", out _));
    }

    [Fact]
    public async Task SeveralHomeys_EachConnectAndNeedTheirOwnName()
    {
        await RemoveAllAsync();
        var first = (await AddAsync("Home")).GetProperty("id").GetInt32();
        var second = (await AddAsync("Holiday home")).GetProperty("id").GetInt32();

        var duplicate = await _client.PostAsJsonAsync("/api/accounts/homey", new { name = "home", address = NoHomey, apiKey = "key" });

        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
        await Eventually(async () =>
            (await _client.GetFromJsonAsync<JsonElement>($"/api/homey/status?account={second}")).GetProperty("connection").GetString() == "disconnected");
        var oldest = await _client.GetFromJsonAsync<JsonElement>("/api/homey/status");
        Assert.Equal(first, oldest.GetProperty("accountId").GetInt32());
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/homey/status?account=999")).StatusCode);
    }

    [Fact]
    public async Task RemovingAnAccount_ForgetsIt()
    {
        await RemoveAllAsync();
        var id = (await AddAsync("Home")).GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.OK, (await _client.DeleteAsync($"/api/accounts/homey/{id}")).StatusCode);

        Assert.Equal(0, (await HomeyAccountsAsync()).GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync($"/api/accounts/homey/{id}")).StatusCode);
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
    public async Task AFakeHomey_HasOneAccountThatCannotChange()
    {
        var info = await _client.GetFromJsonAsync<JsonElement>("/api/accounts/homey");
        Assert.True(info.GetProperty("fake").GetBoolean());
        Assert.Equal("Fake Homey", Assert.Single(info.GetProperty("accounts").EnumerateArray()).GetProperty("name").GetString());

        var added = await _client.PostAsJsonAsync("/api/accounts/homey", new { name = "Home", address = "192.168.1.10", apiKey = "key" });
        var removed = await _client.DeleteAsync("/api/accounts/homey/1");

        Assert.Equal(HttpStatusCode.Conflict, added.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, removed.StatusCode);
    }
}

using System.Net;
using System.Net.Sockets;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using HomeyDash.AirPlay.Crypto;
using HomeyDash.AirPlay.Protocol;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace HomeyDash.AirPlay.Tests;

/// <summary>
/// An Apple TV for the tests: the receiver's side of pair-setup, pair-verify, the encrypted control connection and the
/// event connection, built from the same specification so the client's every step is exercised against a listener.
/// </summary>
internal sealed class FakeReceiver : IDisposable
{
    public const string Pin = "1234";

    private readonly TcpListener _control = new(IPAddress.Loopback, 0), _events = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource _stop = new();
    private readonly byte[] _seed = RandomNumberGenerator.GetBytes(32);
    private readonly byte[] _id = Encoding.ASCII.GetBytes("11111111-2222-3333-4444-555555555555");
    private readonly List<string> _requests = [];
    private readonly List<Dictionary<string, object?>> _commands = [];
    private byte[]? _clientPublic;
    private byte[]? _clientId;
    private byte[]? _shared;
    private readonly List<TcpClient> _clients = [];
    private Stream? _eventStream;
    private HapStream? _eventHap;

    /// <summary>What the receiver reports once told to play: playing, or null to say nothing, as a receiver that can't play.</summary>
    public string? ReportAfterPlay { get; set; } = "playing";
    public bool RefuseCommands { get; set; }

    public FakeReceiver()
    {
        _control.Start();
        _events.Start();
        _ = Task.Run(AcceptControlAsync);
        _ = Task.Run(AcceptEventsAsync);
    }

    public Receiver Receiver => new("AA:BB:CC:DD:EE:FF", "Fake TV", IPAddress.Loopback, ((IPEndPoint)_control.LocalEndpoint).Port, Receiver.Tv, "AppleTV14,1");
    public IReadOnlyList<string> Requests { get { lock (_requests) return [.. _requests]; } }
    public IReadOnlyList<Dictionary<string, object?>> Commands { get { lock (_requests) return [.. _commands]; } }

    /// <summary>Credentials as pairing would have left them, for tests that only play.</summary>
    public Credentials PairedCredentials(byte[]? seed = null)
    {
        seed ??= RandomNumberGenerator.GetBytes(32);
        _clientPublic = Keys.SigningPublic(seed);
        _clientId = "CLIENT-ID"u8.ToArray();
        return new Credentials(Keys.SigningPublic(_seed), seed, _id, _clientId);
    }

    public Task SendEventAsync(string state)
    {
        var inner = BinaryPlist.Write(new Dictionary<string, object?> { ["type"] = "playbackState", ["params"] = new Dictionary<string, object?> { ["playbackState"] = state } });
        var body = BinaryPlist.Write(new Dictionary<string, object?> { ["params"] = new Dictionary<string, object?> { ["data"] = inner } });
        var head = Encoding.UTF8.GetBytes($"POST /event RTSP/1.0\r\nContent-Length: {body.Length}\r\nCSeq: 1\r\n\r\n");
        return _eventStream!.WriteAsync(_eventHap!.Encrypt([.. head, .. body])).AsTask();
    }

    // ---- control connection ----

    private async Task AcceptControlAsync()
    {
        try
        {
            while (!_stop.IsCancellationRequested)
            {
                var client = await _control.AcceptTcpClientAsync(_stop.Token);
                lock (_clients) _clients.Add(client);
                _ = Task.Run(() => ServeControlAsync(client));
            }
        }
        catch (Exception e) when (e is OperationCanceledException or ObjectDisposedException or SocketException)
        {
        }
    }

    private async Task ServeControlAsync(TcpClient client)
    {
        using var _ = client;
        var stream = client.GetStream();
        HapStream? hap = null;
        var buffer = new List<byte>();
        var chunk = new byte[16384];
        var srp = new ServerSrp(Pin);
        byte[]? pairVerifyShared = null, verifyKey = null, verifyReceiverPublic = null, verifyClientPublic = null;
        try
        {
            while (true)
            {
                var read = await stream.ReadAsync(chunk, _stop.Token);
                if (read == 0) return;
                buffer.AddRange(hap is null ? chunk.AsSpan(0, read).ToArray() : hap.Decrypt(chunk.AsSpan(0, read)));
                while (TryTake(buffer, out var request))
                {
                    lock (_requests) _requests.Add($"{request.Method} {request.Uri}");
                    byte[] body = [];
                    var status = "200 OK";
                    var protocol = request.Protocol;
                    switch (request.Uri)
                    {
                        case "/pair-pin-start":
                            break;
                        case "/pair-setup":
                            (body, status) = PairSetup(request.Body, srp);
                            break;
                        case "/pair-verify":
                            (body, status, var finished) = PairVerifyStep(request.Body, ref pairVerifyShared, ref verifyKey, ref verifyReceiverPublic, ref verifyClientPublic);
                            if (finished) _shared = pairVerifyShared;
                            break;
                        default:
                            (body, status) = await Rtsp(request);
                            break;
                    }
                    var head = $"{protocol} {status}\r\nContent-Length: {body.Length}\r\nCSeq: {request.Headers.GetValueOrDefault("CSeq", "0")}\r\n\r\n";
                    var message = Encoding.UTF8.GetBytes(head).Concat(body).ToArray();
                    await stream.WriteAsync(hap is null ? message : hap.Encrypt(message), _stop.Token);
                    if (request.Uri == "/pair-verify" && _shared is not null && hap is null)
                        hap = new HapStream(HapCrypto.Hkdf("Control-Salt", "Control-Read-Encryption-Key", _shared), HapCrypto.Hkdf("Control-Salt", "Control-Write-Encryption-Key", _shared));
                }
            }
        }
        catch (Exception e) when (e is OperationCanceledException or IOException or ObjectDisposedException)
        {
        }
    }

    private async Task<(byte[] Body, string Status)> Rtsp(Req request)
    {
        switch (request.Method, request.Uri)
        {
            case ("SETUP", _) when request.Body.Length > 0:
                var plist = BinaryPlist.ReadDictionary(request.Body);
                if (plist.ContainsKey("streams"))
                    return (BinaryPlist.Write(new Dictionary<string, object?> { ["streams"] = new List<object?> { new Dictionary<string, object?> { ["streamID"] = 1 } } }), "200 OK");
                return (BinaryPlist.Write(new Dictionary<string, object?> { ["eventPort"] = ((IPEndPoint)_events.LocalEndpoint).Port, ["timingPort"] = 7010 }), "200 OK");
            case ("POST", "/command"):
                var outer = BinaryPlist.ReadDictionary(request.Body);
                var command = BinaryPlist.ReadDictionary((byte[])((Dictionary<string, object?>)outer["params"]!)["data"]!);
                lock (_requests) _commands.Add(command);
                if (RefuseCommands) return ([], "500 Internal Server Error");
                if (command["type"] as string == "setRate" && ReportAfterPlay is not null) _ = Task.Run(async () => { await Task.Delay(50); await SendEventAsync(ReportAfterPlay); });
                return ([], "200 OK");
            default:
                return ([], "200 OK");
        }
    }

    // ---- pairing, the receiver's half ----

    private (byte[] Body, string Status) PairSetup(byte[] body, ServerSrp srp)
    {
        var tlv = Tlv8.Read(body);
        switch (tlv[Tag.SeqNo][0])
        {
            case 1:
                return (Tlv8.Write((Tag.SeqNo, [2]), (Tag.Salt, srp.Salt), (Tag.PublicKey, srp.PublicKey)), "200 OK");
            case 3:
                var key = srp.Verify(tlv[Tag.PublicKey], tlv[Tag.Proof]);
                if (key is null) return (Tlv8.Write((Tag.SeqNo, [4]), (Tag.Error, [2])), "200 OK");
                srp.SessionKey = key;
                return (Tlv8.Write((Tag.SeqNo, [4]), (Tag.Proof, new byte[64])), "200 OK");
            default:
                var sessionKey = HapCrypto.Hkdf("Pair-Setup-Encrypt-Salt", "Pair-Setup-Encrypt-Info", srp.SessionKey!);
                var inner = Tlv8.Read(HapCrypto.Open(sessionKey, "PS-Msg05", tlv[Tag.EncryptedData]));
                var controllerKey = HapCrypto.Hkdf("Pair-Setup-Controller-Sign-Salt", "Pair-Setup-Controller-Sign-Info", srp.SessionKey!);
                if (!Keys.Verify(inner[Tag.PublicKey], [.. controllerKey, .. inner[Tag.Identifier], .. inner[Tag.PublicKey]], inner[Tag.Signature]))
                    return (Tlv8.Write((Tag.SeqNo, [6]), (Tag.Error, [2])), "200 OK");
                _clientPublic = inner[Tag.PublicKey];
                _clientId = inner[Tag.Identifier];

                var accessoryKey = HapCrypto.Hkdf("Pair-Setup-Accessory-Sign-Salt", "Pair-Setup-Accessory-Sign-Info", srp.SessionKey!);
                var publicKey = Keys.SigningPublic(_seed);
                var signature = Keys.Sign(_seed, [.. accessoryKey, .. _id, .. publicKey]);
                var reply = Tlv8.Write((Tag.Identifier, _id), (Tag.PublicKey, publicKey), (Tag.Signature, signature));
                return (Tlv8.Write((Tag.SeqNo, [6]), (Tag.EncryptedData, HapCrypto.Seal(sessionKey, "PS-Msg06", reply))), "200 OK");
        }
    }

    private (byte[] Body, string Status, bool Finished) PairVerifyStep(byte[] body, ref byte[]? shared, ref byte[]? key, ref byte[]? receiverPublic, ref byte[]? clientPublic)
    {
        var tlv = Tlv8.Read(body);
        if (tlv[Tag.SeqNo][0] == 1)
        {
            clientPublic = tlv[Tag.PublicKey];
            var (secret, ownPublic) = Keys.NewAgreementPair();
            receiverPublic = ownPublic;
            shared = Keys.Agree(secret, clientPublic);
            key = HapCrypto.Hkdf("Pair-Verify-Encrypt-Salt", "Pair-Verify-Encrypt-Info", shared);
            var signature = Keys.Sign(_seed, [.. ownPublic, .. _id, .. clientPublic]);
            var inner = Tlv8.Write((Tag.Identifier, _id), (Tag.Signature, signature));
            return (Tlv8.Write((Tag.SeqNo, [2]), (Tag.PublicKey, ownPublic), (Tag.EncryptedData, HapCrypto.Seal(key, "PV-Msg02", inner))), "200 OK", false);
        }
        var proof = Tlv8.Read(HapCrypto.Open(key!, "PV-Msg03", tlv[Tag.EncryptedData]));
        var valid = proof[Tag.Identifier].SequenceEqual(_clientId!) && Keys.Verify(_clientPublic!, [.. clientPublic!, .. proof[Tag.Identifier], .. receiverPublic!], proof[Tag.Signature]);
        return valid
            ? (Tlv8.Write((Tag.SeqNo, [4])), "200 OK", true)
            : (Tlv8.Write((Tag.SeqNo, [4]), (Tag.Error, [2])), "200 OK", false);
    }

    // ---- event connection ----

    private async Task AcceptEventsAsync()
    {
        try
        {
            var client = await _events.AcceptTcpClientAsync(_stop.Token);
            lock (_clients) _clients.Add(client);
            _eventStream = client.GetStream();
            // Only the shared secret from pair-verify is needed, which is there before the first SETUP answer is sent.
            while (_shared is null) await Task.Delay(10, _stop.Token);
            _eventHap = new HapStream(HapCrypto.Hkdf("Events-Salt", "Events-Write-Encryption-Key", _shared), HapCrypto.Hkdf("Events-Salt", "Events-Read-Encryption-Key", _shared));
            var chunk = new byte[4096];
            while (await _eventStream.ReadAsync(chunk, _stop.Token) > 0)
            {
                // The client's 200 answers to events; nothing to do with them.
            }
        }
        catch (Exception e) when (e is OperationCanceledException or IOException or ObjectDisposedException or SocketException)
        {
        }
    }

    // ---- HTTP framing ----

    private sealed record Req(string Method, string Uri, string Protocol, Dictionary<string, string> Headers, byte[] Body);

    private static bool TryTake(List<byte> buffer, out Req request)
    {
        request = null!;
        var data = buffer.ToArray();
        var end = data.AsSpan().IndexOf("\r\n\r\n"u8);
        if (end < 0) return false;
        var lines = Encoding.UTF8.GetString(data, 0, end).Split("\r\n");
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1)) { var colon = line.IndexOf(':'); if (colon > 0) headers[line[..colon].Trim()] = line[(colon + 1)..].Trim(); }
        var length = headers.TryGetValue("Content-Length", out var value) ? int.Parse(value) : 0;
        if (data.Length < end + 4 + length) return false;
        var first = lines[0].Split(' ');
        request = new Req(first[0], first[1], first[2], headers, data[(end + 4)..(end + 4 + length)]);
        buffer.RemoveRange(0, end + 4 + length);
        return true;
    }

    public void Dispose()
    {
        _stop.Cancel();
        _control.Stop();
        _events.Stop();
        lock (_clients) foreach (var client in _clients) client.Dispose();
    }

    /// <summary>The accessory's side of SRP-6a with the same group, hash and byte conventions as the client.</summary>
    private sealed class ServerSrp
    {
        private static readonly BigInteger N = Srp.Prime;
        private static readonly BigInteger G = 5;
        private readonly BigInteger _v, _b, _publicB;
        private readonly string _pin;

        public ServerSrp(string pin)
        {
            _pin = pin;
            Salt = RandomNumberGenerator.GetBytes(16);
            var x = HashInt(Salt, Hash(Encoding.UTF8.GetBytes("Pair-Setup:" + pin)));
            _v = BigInteger.ModPow(G, x, N);
            _b = new BigInteger(RandomNumberGenerator.GetBytes(32), isUnsigned: true, isBigEndian: true);
            _publicB = (HashInt(Bytes(N), Pad(G)) * _v + BigInteger.ModPow(G, _b, N)) % N;
        }

        public byte[] Salt { get; }
        public byte[] PublicKey => Bytes(_publicB);
        public byte[]? SessionKey { get; set; }

        public byte[]? Verify(byte[] clientPublic, byte[] proof)
        {
            _ = _pin;
            var a = new BigInteger(clientPublic, isUnsigned: true, isBigEndian: true);
            var u = HashInt(Pad(a), Pad(_publicB));
            var premaster = BigInteger.ModPow(a * BigInteger.ModPow(_v, u, N) % N, _b, N);
            var key = Hash(Bytes(premaster));
            var expected = Hash(Bytes(HashInt(Bytes(N)) ^ HashInt(Bytes(G))), Bytes(HashInt(Encoding.UTF8.GetBytes("Pair-Setup"))), Salt, Bytes(a), Bytes(_publicB), key);
            return expected.SequenceEqual(proof) ? key : null;
        }

        private static byte[] Bytes(BigInteger value) => value.ToByteArray(isUnsigned: true, isBigEndian: true);
        private static byte[] Pad(BigInteger value) { var bytes = Bytes(value); var padded = new byte[384]; bytes.CopyTo(padded, 384 - bytes.Length); return padded; }
        private static byte[] Hash(params byte[][] parts) => SHA512.HashData(parts.SelectMany(p => p).ToArray());
        private static BigInteger HashInt(params byte[][] parts) => new(Hash(parts), isUnsigned: true, isBigEndian: true);
    }
}

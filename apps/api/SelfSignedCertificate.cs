using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace HomeyDash.Api;

/// <summary>
/// A self-signed certificate for serving HTTPS without a proxy in front. It is created on the first boot and
/// stored at <c>path</c>, so browsers see the same certificate across restarts and a trust exception sticks.
/// It is replaced when it is about to expire.
/// </summary>
public static class SelfSignedCertificate
{
    public static X509Certificate2 LoadOrCreate(string path, IEnumerable<string> extraHosts)
    {
        if (File.Exists(path))
        {
            try
            {
                var existing = X509CertificateLoader.LoadPkcs12FromFile(path, null);
                if (existing.NotAfter > DateTime.Now.AddDays(30))
                {
                    return existing;
                }
                existing.Dispose();
            }
            catch (CryptographicException)
            {
                // Unreadable or corrupt: fall through and create a new one.
            }
        }

        using var created = Create(extraHosts);
        var pfx = created.Export(X509ContentType.Pfx);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        File.WriteAllBytes(path, pfx);
        // Reload from the PFX: an in-memory certificate has no persisted key on every platform.
        return X509CertificateLoader.LoadPkcs12(pfx, null);
    }

    private static X509Certificate2 Create(IEnumerable<string> extraHosts)
    {
        using var key = RSA.Create(2048);
        var request = new CertificateRequest("CN=homey-dash", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);

        var names = new SubjectAlternativeNameBuilder();
        names.AddDnsName("localhost");
        names.AddDnsName(Dns.GetHostName());
        names.AddIpAddress(IPAddress.Loopback);
        names.AddIpAddress(IPAddress.IPv6Loopback);
        foreach (var address in NetworkInterface.GetAllNetworkInterfaces()
                     .SelectMany(i => i.GetIPProperties().UnicastAddresses)
                     .Select(a => a.Address)
                     .Where(a => a.AddressFamily == AddressFamily.InterNetwork))
        {
            names.AddIpAddress(address);
        }
        // The container only knows its own addresses, so the host it is reached at (NAS name or IP) comes from config.
        foreach (var host in extraHosts.Select(h => h.Trim()).Where(h => h.Length > 0))
        {
            if (IPAddress.TryParse(host, out var ip))
            {
                names.AddIpAddress(ip);
            }
            else
            {
                names.AddDnsName(host);
            }
        }

        request.CertificateExtensions.Add(names.Build());
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(
            X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(
            [new Oid("1.3.6.1.5.5.7.3.1")], false));

        return request.CreateSelfSigned(DateTimeOffset.Now.AddDays(-1), DateTimeOffset.Now.AddYears(3));
    }
}

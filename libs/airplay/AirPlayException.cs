namespace HomeyDash.AirPlay;

/// <summary>What went wrong talking to a receiver, in words fit to show the user.</summary>
public sealed class AirPlayException(string message, Exception? inner = null) : Exception(message, inner);

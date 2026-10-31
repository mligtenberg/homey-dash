using System.Threading.Channels;
using HomeyDash.Api.Realtime;
using Microsoft.AspNetCore.SignalR;

namespace HomeyDash.Api.Rules;

/// <summary>
/// The rules realtime connections subscribed to (ADR-0010). Whenever a signal may have changed, and at the moment a
/// time-based condition's answer would change, every rule is evaluated again; a connection is sent the answers that
/// changed in one <c>RuleAnswers</c> message. Messages go out one at a time, in the order they were made.
/// </summary>
public sealed class RuleSubscriptions : IDisposable
{
    private sealed class Subscription(Rule rule, RuleContext context)
    {
        public Rule Rule => rule;
        public RuleContext Context => context;
        public bool Holds;
        public DateTimeOffset? Next;
    }

    private readonly RuleEngine _engine;
    private readonly IHubContext<RealtimeHub> _hub;
    private readonly TimeProvider _time;
    private readonly ILogger<RuleSubscriptions> _logger;
    private readonly Lock _lock = new();
    private readonly Dictionary<(string Connection, string Id), Subscription> _subscriptions = [];
    private readonly ITimer _timer;
    private readonly Channel<(string Connection, RuleAnswers Answers)> _outbox = Channel.CreateUnbounded<(string, RuleAnswers)>();
    private long _seq;

    public RuleSubscriptions(RuleEngine engine, IHubContext<RealtimeHub> hub, TimeProvider time, ILogger<RuleSubscriptions> logger)
    {
        _engine = engine;
        _hub = hub;
        _time = time;
        _logger = logger;
        _timer = time.CreateTimer(_ => Reevaluate(), null, Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
        _engine.Changed += Reevaluate;
        _ = SendAllAsync();
    }

    /// <summary>Subscribes a connection to a rule under an id it chose, replacing one it had under that id; answers at once.</summary>
    public RuleAnswer Subscribe(string connectionId, string id, Rule rule, RuleContext context)
    {
        lock (_lock)
        {
            var subscription = new Subscription(rule, context);
            (subscription.Holds, subscription.Next) = _engine.Evaluate(rule, context);
            _subscriptions[(connectionId, id)] = subscription;
            Schedule();
            return new RuleAnswer(subscription.Holds, ++_seq);
        }
    }

    public void Unsubscribe(string connectionId, string id)
    {
        lock (_lock) _subscriptions.Remove((connectionId, id));
    }

    // Every subscription of a connection that closed.
    public void Drop(string connectionId)
    {
        lock (_lock)
            foreach (var key in _subscriptions.Keys.Where(k => k.Connection == connectionId).ToList())
                _subscriptions.Remove(key);
    }

    private void Reevaluate()
    {
        lock (_lock)
        {
            var changed = new Dictionary<string, Dictionary<string, bool>>();
            foreach (var ((connection, id), subscription) in _subscriptions)
            {
                var before = subscription.Holds;
                (subscription.Holds, subscription.Next) = _engine.Evaluate(subscription.Rule, subscription.Context);
                if (subscription.Holds == before) continue;
                if (!changed.TryGetValue(connection, out var answers)) changed[connection] = answers = [];
                answers[id] = subscription.Holds;
            }
            foreach (var (connection, answers) in changed) _outbox.Writer.TryWrite((connection, new RuleAnswers(++_seq, answers)));
            Schedule();
        }
    }

    // Wakes at the earliest moment a time-based condition's answer could change.
    private void Schedule()
    {
        var next = _subscriptions.Values.Select(s => s.Next).Where(n => n is not null).Min();
        _timer.Change(next is { } at ? Max(at - _time.GetUtcNow(), TimeSpan.Zero) : Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
    }

    private static TimeSpan Max(TimeSpan a, TimeSpan b) => a > b ? a : b;

    private async Task SendAllAsync()
    {
        await foreach (var (connection, answers) in _outbox.Reader.ReadAllAsync())
        {
            try
            {
                await _hub.Clients.Client(connection).SendAsync("RuleAnswers", answers);
            }
            catch (Exception e)
            {
                _logger.LogWarning(e, "Could not send rule answers to {Connection}", connection);
            }
        }
    }

    public void Dispose()
    {
        _engine.Changed -= Reevaluate;
        _timer.Dispose();
        _outbox.Writer.TryComplete();
    }
}

using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hkharp.PosHardwareBridge.Hardware;

var builder = WebApplication.CreateBuilder(args);

var listenUrl = builder.Configuration["HardwareBridge:ListenUrl"] ?? "http://127.0.0.1:17880";
builder.WebHost.UseUrls(listenUrl);

var allowedOriginsRaw = builder.Configuration["HardwareBridge:AllowedOrigins"]
    ?? "http://localhost:3501,http://127.0.0.1:3501,http://localhost:3100,http://127.0.0.1:3100";
var allowedOrigins = allowedOriginsRaw
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy
            .WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();
app.UseCors();
app.UseWebSockets();

var configuredToken =
    Environment.GetEnvironmentVariable("HARDWARE_BRIDGE_TOKEN")
    ?? builder.Configuration["HardwareBridge:Token"]
    ?? "dev-local-bridge-token-change-me";
var rwlDllPath = builder.Configuration["Octopus:RwlDllPath"] ?? @"C:\RWL\rwl.dll";
var rwlIniPath = builder.Configuration["Octopus:RwlIniPath"] ?? @"C:\RWL\rwl.ini";
var maxOctopusHkd = app.Configuration.GetValue("Octopus:MaxValueHkd", 3000);
var simulatorEnabled =
    string.Equals(Environment.GetEnvironmentVariable("OCTOPUS_SIMULATOR_ENABLED"), "true", StringComparison.OrdinalIgnoreCase)
    || app.Configuration.GetValue("Octopus:SimulatorEnabled", false)
    || app.Environment.IsDevelopment();
var paxEdcEnabled = app.Configuration.GetValue("PaxEdc:Enabled", false);
var journalFilePath = Path.Combine(
    app.Environment.ContentRootPath,
    builder.Configuration["Octopus:JournalPath"] ?? @"App_Data\bridge-journal.json");

var journalGate = new object();
BridgeJournalState LoadJournal()
{
    lock (journalGate)
    {
        if (!File.Exists(journalFilePath))
        {
            return new BridgeJournalState(new Dictionary<string, string>(), new List<OctopusJournalEntry>());
        }
        try
        {
            var json = File.ReadAllText(journalFilePath);
            return JsonSerializer.Deserialize<BridgeJournalState>(json)
                ?? new BridgeJournalState(new Dictionary<string, string>(), new List<OctopusJournalEntry>());
        }
        catch
        {
            return new BridgeJournalState(new Dictionary<string, string>(), new List<OctopusJournalEntry>());
        }
    }
}

void SaveJournal(BridgeJournalState state)
{
    lock (journalGate)
    {
        var dir = Path.GetDirectoryName(journalFilePath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var tmp = journalFilePath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(state, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(tmp, journalFilePath, overwrite: true);
    }
}

var initialState = LoadJournal();
var incompleteLocks = new ConcurrentDictionary<string, string>(initialState.IncompleteLocks);
var journalEntries = initialState.Transactions;

void PersistState()
{
    SaveJournal(new BridgeJournalState(
        new Dictionary<string, string>(incompleteLocks),
        journalEntries.TakeLast(500).ToList()));
}

bool IsAuthorized(HttpContext ctx)
{
    if (ctx.Request.Headers.TryGetValue("Authorization", out var auth))
    {
        var raw = auth.ToString();
        if (raw.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            var token = raw["Bearer ".Length..].Trim();
            return CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(token),
                Encoding.UTF8.GetBytes(configuredToken));
        }
    }
    if (ctx.Request.Headers.TryGetValue("X-Bridge-Token", out var xtok))
    {
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(xtok.ToString().Trim()),
            Encoding.UTF8.GetBytes(configuredToken));
    }
    return false;
}

app.MapGet("/health", () =>
{
    var probe = RwlNative.ProbeEnvironment(rwlDllPath, rwlIniPath);
    return Results.Ok(new
    {
        type = "BRIDGE_STATUS",
        version = "0.2.0",
        arch = "x86",
        processIs64Bit = Environment.Is64BitProcess,
        octopusReaderReady = probe.RwlDllPresent && probe.RwlIniPresent,
        simulatorEnabled,
        rwlDllPresent = probe.RwlDllPresent,
        rwlIniPresent = probe.RwlIniPresent,
        configuredComPort = probe.ConfiguredComPort,
        blacklistUpToDate = true,
        printerReady = true,
        integratedPaxEdcEnabled = paxEdcEnabled,
        activeIncompleteLocks = incompleteLocks.Count,
        journalCount = journalEntries.Count,
    });
});

app.MapPost("/octopus/deduct", (HttpContext ctx, OctopusDeductRequest req) =>
{
    if (!IsAuthorized(ctx)) return Results.Unauthorized();

    if (req.AmountCents <= 0 || req.AmountCents % 10 != 0)
    {
        return Results.BadRequest(new
        {
            type = "OCTOPUS_DECLINED",
            requestId = req.RequestId,
            errorCode = 100099,
            message = "Deduction only multiply of 10 cents allowed",
        });
    }

    if (req.AmountCents > maxOctopusHkd * 100)
    {
        return Results.BadRequest(new
        {
            type = "OCTOPUS_DECLINED",
            requestId = req.RequestId,
            errorCode = 100098,
            message = $"Amount exceeds OctoMaxValue HK${maxOctopusHkd}",
        });
    }

    if (incompleteLocks.TryGetValue(req.BillRef, out var lockedCardId) &&
        !string.Equals(lockedCardId, req.ExpectedRetryCardId, StringComparison.Ordinal))
    {
        return Results.Conflict(new
        {
            type = "OCTOPUS_INCOMPLETE_100022",
            requestId = req.RequestId,
            billRef = req.BillRef,
            lockedCardId,
            promptEn = "+++DO NOT CANCEL THE TXN+++ Transaction Incomplete! Please request customer to present the same card again (100022).",
            promptZh = "+++請勿取消交易+++ 交易未完成，請顧客再次拍同一張八達通卡 (100022)。",
        });
    }

    var probe = RwlNative.ProbeEnvironment(rwlDllPath, rwlIniPath);
    if (!probe.RwlDllPresent)
    {
        if (!simulatorEnabled)
        {
            return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        }

        var simCard = string.IsNullOrWhiteSpace(req.ExpectedRetryCardId) ? "88419204" : req.ExpectedRetryCardId.Trim();
        var simRecovered = incompleteLocks.TryRemove(req.BillRef, out _);
        var simRemaining = Math.Max(0, 20000 - req.AmountCents);
        lock (journalGate)
        {
            journalEntries.Add(new OctopusJournalEntry(
                req.RequestId,
                req.BillRef,
                simCard,
                "SIM-RWL-01",
                req.AmountCents,
                simRemaining,
                simRecovered,
                DateTimeOffset.UtcNow));
        }
        PersistState();
        return Results.Ok(new
        {
            type = "OCTOPUS_APPROVED",
            requestId = req.RequestId,
            billRef = req.BillRef,
            cardId = simCard,
            deviceId = "SIM-RWL-01",
            deductedCents = req.AmountCents,
            remainingValueCents = simRemaining,
            recoveredFrom100022 = simRecovered,
        });
    }

    return Results.Ok(new
    {
        type = "OCTOPUS_BRIDGE_READY",
        requestId = req.RequestId,
        billRef = req.BillRef,
        amountCents = req.AmountCents,
        comPort = probe.ConfiguredComPort,
    });
});

app.MapPost("/octopus/simulate", (HttpContext ctx, OctopusSimulateRequest req) =>
{
    if (!simulatorEnabled) return Results.NotFound();
    if (!IsAuthorized(ctx)) return Results.Unauthorized();

    if (req.AmountCents <= 0 || req.AmountCents % 10 != 0)
    {
        return Results.BadRequest(new
        {
            type = "OCTOPUS_DECLINED",
            requestId = req.RequestId,
            errorCode = 100099,
            message = "Deduction only multiply of 10 cents allowed",
        });
    }

    if (req.AmountCents > maxOctopusHkd * 100)
    {
        return Results.BadRequest(new
        {
            type = "OCTOPUS_DECLINED",
            requestId = req.RequestId,
            errorCode = 100098,
            message = $"Amount exceeds OctoMaxValue HK${maxOctopusHkd}",
        });
    }

    var presentedCard = string.IsNullOrWhiteSpace(req.CardId) ? "88419204" : req.CardId.Trim();

    if (string.Equals(req.SimulateOutcome, "INCOMPLETE_100022", StringComparison.OrdinalIgnoreCase))
    {
        incompleteLocks[req.BillRef] = presentedCard;
        PersistState();
        return Results.Conflict(new
        {
            type = "OCTOPUS_INCOMPLETE_100022",
            requestId = req.RequestId,
            billRef = req.BillRef,
            lockedCardId = presentedCard,
            promptEn = "+++DO NOT CANCEL THE TXN+++ Transaction Incomplete! Please request customer to present the same card again (100022).",
            promptZh = "+++請勿取消交易+++ 交易未完成，請顧客再次拍同一張八達通卡 (100022)。",
        });
    }

    if (incompleteLocks.TryGetValue(req.BillRef, out var lockedCardId) &&
        !string.Equals(lockedCardId, presentedCard, StringComparison.Ordinal))
    {
        return Results.Conflict(new
        {
            type = "OCTOPUS_INCOMPLETE_100022",
            requestId = req.RequestId,
            billRef = req.BillRef,
            lockedCardId,
            promptEn = $"Card mismatch: expected locked card {lockedCardId}, got {presentedCard}. Present the same card again (100022).",
            promptZh = $"卡號不符：請使用同一張八達通卡 ({lockedCardId}) 完成交易 (100022)。",
        });
    }

    var recovered = incompleteLocks.TryRemove(req.BillRef, out _);
    var remainingCents = Math.Max(0, 20000 - req.AmountCents);
    lock (journalGate)
    {
        journalEntries.Add(new OctopusJournalEntry(
            req.RequestId,
            req.BillRef,
            presentedCard,
            "SIM-RWL-01",
            req.AmountCents,
            remainingCents,
            recovered,
            DateTimeOffset.UtcNow));
    }
    PersistState();

    return Results.Ok(new
    {
        type = "OCTOPUS_APPROVED",
        requestId = req.RequestId,
        billRef = req.BillRef,
        cardId = presentedCard,
        deviceId = "SIM-RWL-01",
        deductedCents = req.AmountCents,
        remainingValueCents = remainingCents,
        recoveredFrom100022 = recovered,
    });
});

app.MapPost("/octopus/xfile", (HttpContext ctx) =>
{
    if (!IsAuthorized(ctx)) return Results.Unauthorized();
    return Results.Ok(new
    {
        type = "OCTOPUS_XFILE_SUMMARY",
        pendingLocks = incompleteLocks.Count,
        journalTransactions = journalEntries.Count,
        totalCents = journalEntries.Sum(e => e.AmountCents),
        generatedAtIso = DateTimeOffset.UtcNow.ToString("O"),
    });
});

app.MapPost("/print/receipt", (HttpContext ctx, PrintReceiptRequest req) =>
{
    if (!IsAuthorized(ctx)) return Results.Unauthorized();
    var payload = EscPosDrawer.BuildReceiptPayload(req.Lines, req.OpenCashDrawer);
    return Results.Ok(new
    {
        type = "PRINT_COMPLETED",
        requestId = req.RequestId,
        invoiceNo = req.InvoiceNo,
        payloadBytes = payload.Length,
        drawerOpened = req.OpenCashDrawer,
    });
});

app.MapPost("/drawer/open", (HttpContext ctx, OpenDrawerRequest req) =>
{
    if (!IsAuthorized(ctx)) return Results.Unauthorized();
    var kickBytes = EscPosDrawer.BuildDrawerKickCommand();
    return Results.Ok(new
    {
        type = "PRINT_COMPLETED",
        requestId = req.RequestId,
        drawerOpened = true,
        commandBytes = kickBytes.Length,
    });
});

app.Map("/ws", async (HttpContext ctx) =>
{
    if (!ctx.WebSockets.IsWebSocketRequest)
    {
        ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    using var ws = await ctx.WebSockets.AcceptWebSocketAsync();
    var probe = RwlNative.ProbeEnvironment(rwlDllPath, rwlIniPath);
    var statusJson = JsonSerializer.Serialize(new
    {
        type = "BRIDGE_STATUS",
        version = "0.2.0",
        arch = "x86",
        octopusReaderReady = probe.RwlDllPresent && probe.RwlIniPresent,
        simulatorEnabled,
        blacklistUpToDate = true,
        printerReady = true,
        integratedPaxEdcEnabled = paxEdcEnabled,
    });

    var buffer = Encoding.UTF8.GetBytes(statusJson);
    await ws.SendAsync(buffer, System.Net.WebSockets.WebSocketMessageType.Text, true, CancellationToken.None);
});

app.Run();

public sealed record OctopusDeductRequest(string RequestId, string BillRef, int AmountCents, string? ExpectedRetryCardId);
public sealed record OctopusSimulateRequest(string RequestId, string BillRef, int AmountCents, string? CardId, string? SimulateOutcome);
public sealed record PrintReceiptRequest(string RequestId, string InvoiceNo, IReadOnlyList<string> Lines, bool OpenCashDrawer);
public sealed record OpenDrawerRequest(string RequestId, string Reason);
public sealed record OctopusJournalEntry(
    string RequestId,
    string BillRef,
    string CardId,
    string DeviceId,
    int AmountCents,
    int RemainingValueCents,
    bool RecoveredFrom100022,
    DateTimeOffset TransactedAt);
public sealed record BridgeJournalState(
    Dictionary<string, string> IncompleteLocks,
    List<OctopusJournalEntry> Transactions);

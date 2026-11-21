using System.Runtime.InteropServices;

namespace Hkharp.PosHardwareBridge.Hardware;

/// <summary>
/// 32-bit P/Invoke boundary matching eRunOcto.modOcto -> native Octopus rwl.dll.
/// Because rwl.dll is strictly 32-bit x86, this assembly compiles for PlatformTarget=x86 (win-x86).
/// Safe degradation: when rwl.dll is not yet installed on a dev machine, Probe() reports
/// OctopusReaderReady = false without throwing unhandled TypeLoad/DllNotFound exceptions at startup.
/// </summary>
public static partial class RwlNative
{
    public const int INCOMPLETE_TXN_CODE = 100022;
    public const int ERROR_OFFSET = 100000;

    [DllImport("rwl.dll", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    public static extern int InitComm(int port, int baud);

    [DllImport("rwl.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int PortClose();

    [DllImport("rwl.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int TimeVer(byte[] buf);

    [DllImport("rwl.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int TxnAmt(int amtInTenths, int refundFlag, byte[] cardType);

    [DllImport("rwl.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int Poll(int timeoutTenths, int subCom, byte[] pollData);

    [DllImport("rwl.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int Deduct(int amtInTenths, byte[] addInfo);

    [DllImport("rwl.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int XFile(byte[] xfileName);

    [DllImport("rwl.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int HouseKeeping();

    [DllImport("rwl.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int GetSysInfo(byte[] sysInfo);

    public static (bool RwlDllPresent, bool RwlIniPresent, int ConfiguredComPort) ProbeEnvironment(
        string rwlDllPath,
        string rwlIniPath)
    {
        var dllPresent = File.Exists(rwlDllPath);
        var iniPresent = File.Exists(rwlIniPath);
        var port = 0;

        if (iniPresent)
        {
            foreach (var rawLine in File.ReadLines(rwlIniPath))
            {
                var line = rawLine.Trim();
                if (line.StartsWith("PORT=", StringComparison.OrdinalIgnoreCase) &&
                    int.TryParse(line[5..].Trim(), out var parsed))
                {
                    port = parsed;
                    break;
                }
            }
        }

        return (dllPresent, iniPresent, port);
    }
}

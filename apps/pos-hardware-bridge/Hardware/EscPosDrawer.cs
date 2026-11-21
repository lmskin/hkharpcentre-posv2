using System.Text;

namespace Hkharp.PosHardwareBridge.Hardware;

/// <summary>
/// Builds raw ESC/POS receipt buffers and RJ11 cash drawer kick sequences (ESC p 0 25 250)
/// for local counter thermal printers.
/// </summary>
public static class EscPosDrawer
{
    public static byte[] BuildDrawerKickCommand(byte pin = 0)
    {
        // Standard ESC p m t1 t2 (Pin 2 / Pin 5 pulse)
        return [0x1B, 0x70, pin, 0x19, 0xFA];
    }

    public static byte[] BuildReceiptPayload(IEnumerable<string> lines, bool openDrawer)
    {
        using var ms = new MemoryStream();
        // Initialize ESC/POS printer (ESC @)
        ms.Write([0x1B, 0x40]);

        foreach (var line in lines)
        {
            var bytes = Encoding.UTF8.GetBytes(line + "\n");
            ms.Write(bytes);
        }

        // Feed & partial cut (GS V 66 3)
        ms.Write([0x1D, 0x56, 0x42, 0x03]);

        if (openDrawer)
        {
            ms.Write(BuildDrawerKickCommand());
        }

        return ms.ToArray();
    }
}

Option Explicit
Dim shell, env, http, forceRestart, requestError
forceRestart = False
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "--force" Then forceRestart = True
End If

If Not forceRestart Then
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1500, 1500
  http.open "GET", "http://127.0.0.1:3501/api/health", False
  http.send
  requestError = Err.Number
  Err.Clear
  On Error GoTo 0
  If requestError = 0 Then
    If http.status = 200 Then WScript.Quit 0
  End If
End If

Set shell = CreateObject("WScript.Shell")
Set env = shell.Environment("Process")
env("POS_HIDDEN_BG") = "1"
shell.Run """C:\hkharpcentre-posv2\scripts\start-pos.cmd""", 0, False

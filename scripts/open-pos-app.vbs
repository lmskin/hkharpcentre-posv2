Option Explicit
Dim shell, fso, http, ready, i, chromePath, edgePath, url
url = "http://127.0.0.1:3501"
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

Function IsServerHealthy()
  Dim requestError
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1500, 1500
  http.open "GET", url & "/api/health", False
  http.send
  requestError = Err.Number
  Err.Clear
  On Error GoTo 0
  If requestError <> 0 Then
    IsServerHealthy = False
  Else
    IsServerHealthy = (http.status = 200)
  End If
End Function

ready = IsServerHealthy()
If Not ready Then
  shell.Run """C:\Windows\System32\wscript.exe"" //B //NoLogo ""C:\hkharpcentre-posv2\scripts\start-pos-hidden.vbs""", 0, False
  For i = 1 To 40
    WScript.Sleep 500
    If IsServerHealthy() Then
      ready = True
      Exit For
    End If
  Next
End If

chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

If fso.FileExists(chromePath) Then
  shell.Run """" & chromePath & """ --app=" & url & " --start-maximized", 1, False
ElseIf fso.FileExists(edgePath) Then
  shell.Run """" & edgePath & """ --app=" & url & " --start-maximized", 1, False
Else
  shell.Run url, 1, False
End If

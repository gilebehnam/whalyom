Set sh = CreateObject("WScript.Shell")
Set http = CreateObject("MSXML2.ServerXMLHTTP")
up = False
On Error Resume Next
http.Open "GET", "http://localhost:4321/api/connectors", False
http.Send
If Err.Number = 0 And http.Status = 200 Then up = True
On Error GoTo 0
If Not up Then
  sh.CurrentDirectory = "F:\MyP\OM"
  sh.Run """C:\Program Files\nodejs\node.exe"" ""F:\MyP\OM\tools\hub-service.mjs""", 0, False
  WScript.Sleep 3500
End If
Set fso = CreateObject("Scripting.FileSystemObject")
edge = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
chrome = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe"
If fso.FileExists(edge) Then
  sh.Run """" & edge & """ --app=http://localhost:4321", 1, False
ElseIf fso.FileExists(chrome) Then
  sh.Run """" & chrome & """ --app=http://localhost:4321", 1, False
Else
  sh.Run "http://localhost:4321", 1, False
End If

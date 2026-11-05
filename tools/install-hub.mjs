// Installs the Whalyom Hub on this Windows computer (no admin rights needed):
//   - a Startup entry so the hub (tools/hub-service.mjs) starts hidden at every login;
//   - a "Whalyom" desktop shortcut that starts the hub if needed and opens the Command Center
//     as an app window (Edge or Chrome app mode, else the default browser);
//   - starts the hub now.
//   node tools/install-hub.mjs [--uninstall]
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root } from './lib/env.mjs';

if (process.platform !== 'win32') { console.error('This installer is for Windows. On macOS/Linux, run `node tools/hub-service.mjs` from a login item or systemd user service.'); process.exit(2); }
const appData = process.env.APPDATA;
const startup = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Whalyom Hub.vbs');
const desktop = execFileSync('powershell', ['-NoProfile', '-Command', '[Environment]::GetFolderPath("Desktop")'], { encoding: 'utf8' }).trim();
const shortcut = path.join(desktop, 'Whalyom.lnk');
const launcher = path.join(root, 'tools', 'whalyom-open.vbs');
const iconFile = path.join(root, 'tools', 'whalyom.ico');
const nodeExe = process.execPath;
const url = `http://localhost:${process.env.WHALYOM_PORT ?? 4321}`;

if (process.argv.includes('--uninstall')) {
  for (const f of [startup, shortcut]) fs.rmSync(f, { force: true });
  console.log('Removed the Startup entry and the desktop shortcut. Stop a running hub from Task Manager (node.exe running hub-service.mjs).');
  process.exit(0);
}

const q = (s) => s.replace(/"/g, '""');
// Hidden start of the hub (window style 0).
fs.writeFileSync(startup, `Set sh = CreateObject("WScript.Shell")\nsh.CurrentDirectory = "${q(root)}"\nsh.Run """${q(nodeExe)}"" ""${q(path.join(root, 'tools', 'hub-service.mjs'))}""", 0, False\n`);
// One-click opener: start the hub if the page is not answering, then open the app window.
fs.writeFileSync(launcher, `Set sh = CreateObject("WScript.Shell")
Set http = CreateObject("MSXML2.ServerXMLHTTP")
up = False
On Error Resume Next
http.Open "GET", "${url}/api/connectors", False
http.Send
If Err.Number = 0 And http.Status = 200 Then up = True
On Error GoTo 0
If Not up Then
  sh.CurrentDirectory = "${q(root)}"
  sh.Run """${q(nodeExe)}"" ""${q(path.join(root, 'tools', 'hub-service.mjs'))}""", 0, False
  WScript.Sleep 3500
End If
Set fso = CreateObject("Scripting.FileSystemObject")
edge = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\\Microsoft\\Edge\\Application\\msedge.exe"
chrome = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\\Google\\Chrome\\Application\\chrome.exe"
If fso.FileExists(edge) Then
  sh.Run """" & edge & """ --app=${url}", 1, False
ElseIf fso.FileExists(chrome) Then
  sh.Run """" & chrome & """ --app=${url}", 1, False
Else
  sh.Run "${url}", 1, False
End If
`);
// Desktop shortcut through the Windows Script Host shell object.
const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${shortcut.replace(/'/g, "''")}');$s.TargetPath='wscript.exe';$s.Arguments='"${launcher.replace(/'/g, "''")}"';$s.WorkingDirectory='${root.replace(/'/g, "''")}';$s.Description='Whalyom Command Center';${fs.existsSync(iconFile) ? `$s.IconLocation='${iconFile.replace(/'/g, "''")}';` : ''}$s.Save()`;
execFileSync('powershell', ['-NoProfile', '-Command', ps]);
// Start the hub now (hidden), unless it is already answering.
const up = await fetch(`${url}/api/connectors`).then((r) => r.ok).catch(() => false);
if (!up) spawn('wscript.exe', [startup], { detached: true, stdio: 'ignore' }).unref();
console.log(JSON.stringify({ startup, shortcut, launcher, url, started: !up }, null, 2));

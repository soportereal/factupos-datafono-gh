' FactuposDatafono - Launcher silencioso
'
' Arranca FactuposDatafono.exe sin ventana de consola.
' El tray icon sigue visible en la bandeja del sistema.
'
' Uso:
'   1) Copiar este archivo en la misma carpeta que FactuposDatafono.exe
'   2) Doble clic — el .exe arranca oculto, no aparece la ventana negra
'   3) Para apagarlo: clic derecho en el tray icon → Salir
'
' Para autostart: poner un acceso directo a este .vbs en
'   C:\Users\<usuario>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
'
' Atajo rápido para abrir Startup: Win+R → shell:startup
'
Option Explicit

Dim sh, fs, exePath, scriptPath
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")

scriptPath = fs.GetParentFolderName(WScript.ScriptFullName)
exePath = scriptPath & "\FactuposDatafono.exe"

If Not fs.FileExists(exePath) Then
    MsgBox "No se encontró FactuposDatafono.exe en:" & vbCrLf & exePath, vbCritical, "FactuposDatafono"
    WScript.Quit 1
End If

' Run con WindowStyle=0 (oculto), bWaitOnReturn=False (no bloquea)
sh.Run """" & exePath & """", 0, False

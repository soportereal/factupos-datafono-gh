; ============================================================================
;  FactuposDatafono — Instalador (Inno Setup 6)
;  Puente local entre FactuPOS web y el datáfono (Promerica / BAC).
;
;  Qué hace:
;    - Instala FactuposDatafono.exe en "Archivos de programa".
;    - Lo configura para ARRANCAR AUTOMÁTICAMENTE con Windows (oculto, con
;      ícono en la bandeja del sistema) vía el launcher silencioso .vbs.
;    - Crea accesos directos en el menú Inicio + desinstalador.
;
;  Se COMPILA solo en GitHub Actions (windows-latest) — ver
;  .github/workflows/build.yml. No requiere Windows local.
;
;  Nota técnica: NO se instala como "servicio de Windows" puro porque el bridge
;  muestra ícono en la bandeja (tray), y un servicio corre en sesión 0 sin UI.
;  El autostart al iniciar sesión cumple lo mismo y conserva el tray.
; ============================================================================

#define MyAppName "FactuposDatafono"
#define MyAppVersion "0.3.1"
#define MyAppPublisher "Soporte Real SRL"
#define MyAppURL "https://soportereal.com"
#define MyAppExeName "FactuposDatafono.exe"
#define MyAppVbs "FactuposDatafono-silencioso.vbs"
#define MyAppIcon "datafono.ico"

[Setup]
AppId={{B7E9F2A4-3C8D-4E1F-9A6B-5D2C8F0E1A37}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=FactuposDatafono-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppIcon}
SetupIconFile={#MyAppIcon}

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "autostart"; Description: "Arrancar automáticamente al iniciar Windows (recomendado)"; GroupDescription: "Inicio automático:"
Name: "startmenu"; Description: "Crear acceso directo en el menú Inicio"; GroupDescription: "Accesos directos:"; Flags: unchecked

[Files]
; El .exe lo genera `npm run build:win` (pkg) ANTES de compilar este instalador.
Source: "..\dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyAppVbs}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyAppIcon}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Accesos directos en el menú Inicio (lanzan el .vbs → sin consola, con tray)
Name: "{group}\{#MyAppName}"; Filename: "wscript.exe"; Parameters: """{app}\{#MyAppVbs}"""; WorkingDir: "{app}"; IconFilename: "{app}\{#MyAppIcon}"; Tasks: startmenu
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"; Tasks: startmenu

[Registry]
; Autostart para TODOS los usuarios al iniciar sesión Windows.
; wscript lanza el .vbs, que arranca el .exe oculto (sin ventana negra) y deja el tray.
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
    ValueType: string; ValueName: "{#MyAppName}"; \
    ValueData: "wscript.exe ""{app}\{#MyAppVbs}"""; \
    Flags: uninsdeletevalue; Tasks: autostart

[Run]
; Arrancar ahora, al terminar la instalación.
Filename: "wscript.exe"; Parameters: """{app}\{#MyAppVbs}"""; \
    Description: "Iniciar {#MyAppName} ahora"; \
    Flags: nowait postinstall skipifsilent

[UninstallRun]
; Cerrar el proceso antes de desinstalar (si está corriendo).
Filename: "taskkill"; Parameters: "/f /im {#MyAppExeName}"; \
    Flags: runhidden; RunOnceId: "KillFactuposDatafono"

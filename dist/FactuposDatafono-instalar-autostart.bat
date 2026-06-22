@echo off
REM FactuposDatafono - Instalador de autostart
REM
REM Crea un acceso directo al .vbs silencioso en la carpeta Startup del usuario,
REM para que el puente arranque automáticamente al iniciar sesión Windows.
REM
REM Uso: ejecutar este .bat (clic derecho > "Ejecutar como administrador" no es necesario)

setlocal

set "BASE=%~dp0"
set "VBS=%BASE%FactuposDatafono-silencioso.vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\FactuposDatafono.lnk"

if not exist "%VBS%" (
    echo [ERROR] No se encontro FactuposDatafono-silencioso.vbs en:
    echo   %BASE%
    echo Coloca este .bat en la misma carpeta que el .vbs y el .exe.
    pause
    exit /b 1
)

echo Creando acceso directo de autostart...
echo   Origen:  %VBS%
echo   Destino: %LNK%
echo.

powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%'); $s.TargetPath='%VBS%'; $s.WorkingDirectory='%BASE%'; $s.Description='FactuposDatafono - Puente datafono FactuPOS'; $s.Save()"

if exist "%LNK%" (
    echo [OK] Autostart instalado correctamente.
    echo.
    echo FactuposDatafono arrancara automaticamente al iniciar sesion Windows.
    echo.
    echo Para desinstalar: elimina %LNK%
    echo o ejecuta FactuposDatafono-desinstalar-autostart.bat
) else (
    echo [ERROR] No se pudo crear el acceso directo.
)
echo.
pause
endlocal

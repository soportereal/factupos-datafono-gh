@echo off
REM FactuposDatafono - Desinstalador de autostart
REM Elimina el acceso directo de la carpeta Startup del usuario.

setlocal

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\FactuposDatafono.lnk"

if exist "%LNK%" (
    del "%LNK%"
    echo [OK] Autostart desinstalado.
    echo FactuposDatafono ya no arrancara automaticamente.
) else (
    echo [INFO] No se encontro autostart instalado.
)
echo.
pause
endlocal

@echo off
chcp 65001 >nul
setlocal

echo ========================================================
echo  Korean Law RAG Windows Ephemeral Build Pipeline
echo ========================================================

REM 0. Environment PATH setup
set "PATH=%APPDATA%\npm;%LOCALAPPDATA%\npm;%USERPROFILE%\.cargo\bin;%ProgramFiles%\nodejs;%PATH%"
set "SRC=Z:\rag"
set "DEST=C:\workspace\rag"
set "TARGET_BASE=%DEST%\src-tauri\target\x86_64-pc-windows-msvc\release\bundle"
set "OUTPUT_DIR=Z:\rag\release"
set "BUILD_STATUS=0"

echo [1/5] Checking source path: %SRC%
if not exist "%SRC%" goto :ERR_NO_SRC
echo - Source drive found.

REM 1. Clean workspace purge and recreation
cd /d C:\
if exist "%DEST%" (
    echo - Purging existing workspace: %DEST%
    rd /s /q "%DEST%" 2>nul
)
echo - Creating clean destination directory: %DEST%
mkdir "%DEST%"

echo.
echo [2/5] Synchronizing files from %SRC% to %DEST% ...
robocopy "%SRC%" "%DEST%" /MIR /XD node_modules target .git .agents data release scratch logs dist-engine dist-server dist-web /XF *.log /MT:8 /R:1 /W:1 /NP /NDL

if %ERRORLEVEL% GEQ 8 goto :ERR_ROBOCOPY
echo - Files synchronized successfully.

cd /d "%DEST%"
if not exist "pnpm-lock.yaml" goto :ERR_NO_LOCK

echo.
echo [3/5] Checking environment and installing dependencies ...

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found in PATH.
    goto :ERR_PNPM
)
echo - Node.js version:
call node -v

where cargo >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo - Cargo version:
    call cargo -V
) else (
    echo [WARN] cargo not found. Please ensure Rust is installed.
)

REM Select pnpm executable
set "PNPM_EXEC=pnpm.cmd"
where pnpm.cmd >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    where pnpm >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        set "PNPM_EXEC=pnpm"
    ) else (
        echo - Installing pnpm globally...
        call npm install -g pnpm
        if exist "%APPDATA%\npm\pnpm.cmd" (
            set "PNPM_EXEC=%APPDATA%\npm\pnpm.cmd"
        ) else (
            set "PNPM_EXEC=npx --yes pnpm"
        )
    )
)

echo - Selected pnpm: %PNPM_EXEC%
echo - Running: %PNPM_EXEC% install ...
call %PNPM_EXEC% install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [WARN] pnpm install failed. Retrying with --no-frozen-lockfile ...
    call %PNPM_EXEC% install --no-frozen-lockfile
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo [ERROR] Failed to install packages.
        goto :ERR_PNPM
    )
)

if exist "scripts\sync-version.js" (
    echo.
    echo - Syncing versions across config files ...
    call node scripts\sync-version.js
    if %ERRORLEVEL% NEQ 0 goto :ERR_SYNC
)

REM Windows backend engine packaging
if not exist "%OUTPUT_DIR%\korean_law_engine_win_x64.tar.gz" (
    echo.
    echo - Windows backend engine runtime not found in release. Packaging engine ...
    call %PNPM_EXEC% run engine:pack
    if exist "release\korean_law_engine_win_x64.tar.gz" (
        copy /y "release\korean_law_engine_win_x64.tar.gz" "%OUTPUT_DIR%\korean_law_engine_win_x64.tar.gz" >nul
        if exist "release\korean_law_engine_win_x64.tar.gz.sha256" (
            copy /y "release\korean_law_engine_win_x64.tar.gz.sha256" "%OUTPUT_DIR%\korean_law_engine_win_x64.tar.gz.sha256" >nul
        )
        echo - Windows backend engine packaged and deployed to %OUTPUT_DIR%.
    )
)

echo.
echo [4/5] Starting Tauri Release Build ...
call %PNPM_EXEC% tauri build --target x86_64-pc-windows-msvc -- --locked
if %ERRORLEVEL% NEQ 0 goto :ERR_BUILD

echo.
echo [5/5] Deploying build artifacts ...

if not exist "%OUTPUT_DIR%" (
    echo - Creating output directory: %OUTPUT_DIR%
    mkdir "%OUTPUT_DIR%"
)

set "DEPLOYED=0"

for /r "%TARGET_BASE%" %%F in (*.msi) do (
    echo - Found MSI installer: %%F
    echo - Deploying to: %OUTPUT_DIR%\Korean-Law-RAG-latest.msi
    copy /y "%%F" "%OUTPUT_DIR%\Korean-Law-RAG-latest.msi" >nul
    if %ERRORLEVEL% EQU 0 set "DEPLOYED=1"
    goto :CHECK_EXE
)

:CHECK_EXE
for /r "%TARGET_BASE%" %%F in (*.exe) do (
    echo - Found NSIS installer: %%F
    echo - Deploying to: %OUTPUT_DIR%\Korean-Law-RAG-latest-setup.exe
    copy /y "%%F" "%OUTPUT_DIR%\Korean-Law-RAG-latest-setup.exe" >nul
    if %ERRORLEVEL% EQU 0 set "DEPLOYED=1"
    goto :CHECK_STATUS
)

:CHECK_STATUS
if "%DEPLOYED%"=="0" (
    if exist "%TARGET_BASE%\msi" (
        for %%F in ("%TARGET_BASE%\msi\*.msi") do (
            echo - Copying %%F to %OUTPUT_DIR%\Korean-Law-RAG-latest.msi
            copy /y "%%F" "%OUTPUT_DIR%\Korean-Law-RAG-latest.msi" >nul
            set "DEPLOYED=1"
        )
    )
    if exist "%TARGET_BASE%\nsis" (
        for %%F in ("%TARGET_BASE%\nsis\*.exe") do (
            echo - Copying %%F to %OUTPUT_DIR%\Korean-Law-RAG-latest-setup.exe
            copy /y "%%F" "%OUTPUT_DIR%\Korean-Law-RAG-latest-setup.exe" >nul
            set "DEPLOYED=1"
        )
    )
)

if "%DEPLOYED%"=="0" goto :ERR_NO_BUNDLE

echo - Artifacts deployed to %OUTPUT_DIR% successfully.

echo.
echo ========================================================
echo [SUCCESS] Windows x86_64 build and deploy completed!
echo ========================================================
goto :CLEANUP

:ERR_NO_SRC
echo.
echo [ERROR] Source drive %SRC% not found.
echo Please check if VMware shared folder Z: is connected.
set "BUILD_STATUS=1"
goto :DONE

:ERR_ROBOCOPY
echo.
echo [ERROR] Robocopy failed with error level %ERRORLEVEL%.
set "BUILD_STATUS=1"
goto :DONE

:ERR_NO_LOCK
echo.
echo [ERROR] pnpm-lock.yaml not found in %DEST%!
set "BUILD_STATUS=1"
goto :DONE

:ERR_PNPM
echo.
echo ========================================================
echo [ERROR] pnpm install failed.
echo Keeping workspace %DEST% for troubleshooting.
echo ========================================================
set "BUILD_STATUS=1"
goto :DONE

:ERR_SYNC
echo.
echo [ERROR] Version sync script failed.
set "BUILD_STATUS=1"
goto :DONE

:ERR_BUILD
echo.
echo ========================================================
echo [ERROR] Tauri build failed.
echo Keeping workspace %DEST% for troubleshooting.
echo ========================================================
set "BUILD_STATUS=1"
goto :DONE

:ERR_NO_BUNDLE
echo.
echo [ERROR] Bundle artifacts not found under: %TARGET_BASE%
set "BUILD_STATUS=1"
goto :DONE

:CLEANUP
echo.
echo ========================================================
echo [CLEANUP] Purging Local Workspace and Global Caches ...
echo ========================================================

cd /d C:\
if exist "%DEST%" (
    echo - Removing workspace: %DEST%
    rd /s /q "%DEST%"
)

echo - Pruning pnpm store...
call %PNPM_EXEC% store prune 2>nul

set "CARGO_HOME_DIR=%USERPROFILE%\.cargo"
if exist "%CARGO_HOME_DIR%\registry" (
    echo - Purging Cargo crate registry cache...
    rd /s /q "%CARGO_HOME_DIR%\registry"
)
if exist "%CARGO_HOME_DIR%\git" (
    echo - Purging Cargo git checkouts cache...
    rd /s /q "%CARGO_HOME_DIR%\git"
)

echo - Disk cleanup completed.

:DONE
echo.
if "%BUILD_STATUS%"=="0" (
    echo [Pipeline Finished Successfully]
) else (
    echo [Pipeline Terminated with Errors]
    echo Note: Workspace at %DEST% was preserved for troubleshooting.
)
echo.
echo ��t D�ȵ��. =D �<$t D4 �� t8�.
pause

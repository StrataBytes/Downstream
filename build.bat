@echo off
echo ========================================
echo   Downstream v2.2.8 - Build Installer
echo ========================================
echo.

echo [1/3] Cleaning previous build...
if exist out rmdir /s /q out
echo Done.

echo.
echo [2/3] Installing dependencies...
call npm run setup
if %errorlevel% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

echo.
echo [3/3] Building installer...
call npm run make
if %errorlevel% neq 0 (
    echo ERROR: Build failed. Check the output above for details.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Build complete!
echo   Output: out\make\squirrel.windows\x64
echo ========================================
pause

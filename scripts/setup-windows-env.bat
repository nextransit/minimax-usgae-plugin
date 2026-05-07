@echo off
echo ==============================
echo Windows Build Environment Setup
echo ==============================

echo.
echo [1/4] Checking Visual Studio...
if exist "C:\Program Files\Microsoft Visual Studio\2022" (
    echo VS 2022 found
    dir "C:\Program Files\Microsoft Visual Studio\2022" /b
) else if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022" (
    echo VS 2022 (x86) found
    dir "C:\Program Files (x86)\Microsoft Visual Studio\2022" /b
) else (
    echo VS 2022 NOT found - WARNING
)

echo.
echo [2/4] Finding vcvars...
for /r "C:\Program Files\Microsoft Visual Studio" %%f in (vcvars64.bat) do @echo %%f
for /r "C:\Program Files (x86)\Microsoft Visual Studio" %%f in (vcvars64.bat) do @echo %%f

echo.
echo [3/4] Checking Node.js...
node -v
echo Installing Node.js 20 via nvm or direct...
where nvm 2>nul
if %errorlevel% neq 0 (
    echo nvm not found
)

echo.
echo [4/4] Checking Rust...
where rustup 2>nul
where cargo 2>nul
if %errorlevel% neq 0 (
    echo Rust NOT installed - installing...
    powershell -Command "Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile %TEMP%\rustup-init.exe"
    %TEMP%\rustup-init.exe -y --default-toolchain stable
)

echo.
echo === Setup Complete ===

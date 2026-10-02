@echo off
REM ============================================
REM   ARTHA Demo Startup Script
REM   Run from: AI-Artha-main root directory
REM ============================================
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo   ARTHA - Financial Management System
echo   Demo Mode Setup
echo ========================================
echo.

REM Step 1: Seed demo data
echo [1/3] Seeding demo data into MongoDB...
cd backend
call npm run seed:demo
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Demo seed failed. Check MongoDB connection.
    pause
    exit /b 1
)
cd ..

echo.
echo [2/3] Starting backend server on port 5000...
start "ARTHA Backend" cmd /k "cd /d %~dp0backend && npm run dev"

REM Wait for backend to start
echo       Waiting for backend to initialize...
timeout /t 8 /nobreak > NUL

echo.
echo [3/3] Starting frontend dev server on port 5173...
start "ARTHA Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ========================================
echo   ARTHA Demo is starting!
echo ========================================
echo.
echo   Backend:  http://localhost:5000
echo   Frontend: http://localhost:5173
echo.
echo   Login credentials:
echo   Email:    admin@brightconnection.in
echo   Password: admin123
echo.
echo   Demo Pages:
echo   - Dashboard:       http://localhost:5173/
echo   - Dealers:         http://localhost:5173/dealers
echo   - Dealer Detail:   http://localhost:5173/dealers/[id]
echo   - Sales Agents:    http://localhost:5173/agents
echo   - Vouchers:        http://localhost:5173/vouchers
echo   - Reports:         http://localhost:5173/reports
echo.
echo ========================================
echo   Press any key in this window to stop.
echo ========================================
pause

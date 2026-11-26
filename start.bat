@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js belum terpasang. Install dari https://nodejs.org & pause & exit /b 1)
if not exist "node_modules\@anthropic-ai\sdk" (
  echo Memasang dependency sekali saja (untuk fitur AI Claude^)...
  call npm install --omit=dev --no-audit --no-fund
)
node server.js %*

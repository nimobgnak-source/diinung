@echo off
chcp 65001 >nul
title 페스타그래프 챗봇
cd /d "%~dp0"

echo ==========================================
echo   페스타그래프 챗봇 실행
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NO_NODE

if not exist ".env.local" goto NO_ENV

if exist "node_modules" goto RUN
echo [처음 한 번만] 필요한 파일을 설치합니다. 1~3분 정도 걸려요...
echo.
call npm.cmd install
if errorlevel 1 goto INSTALL_FAIL

:RUN
echo.
echo 챗봇을 시작합니다. 잠시 후 브라우저가 자동으로 열려요.
echo 브라우저가 안 열리면 주소창에 http://localhost:3000 을 입력하세요.
echo.
echo * 챗봇을 쓰는 동안 이 검은 창을 닫지 마세요. 닫으면 챗봇도 꺼져요.
echo.
start "" cmd /c "timeout /t 10 /nobreak >nul & start http://localhost:3000"
call npm.cmd run dev
goto END

:NO_NODE
echo [안내] Node.js가 설치되어 있지 않아요.
echo        지금 열리는 https://nodejs.org 에서 LTS 버전을 설치한 뒤,
echo        이 파일을 다시 더블클릭하세요.
start "" https://nodejs.org
goto END

:NO_ENV
echo [안내] .env.local 파일이 없어요.
echo        팀장에게 받은 .env.local 파일을 이 폴더에 넣은 뒤,
echo        이 파일을 다시 더블클릭하세요.
echo        넣을 위치: %~dp0
goto END

:INSTALL_FAIL
echo [오류] 설치 중 문제가 생겼어요. 인터넷 연결을 확인하고 다시 실행해 주세요.
goto END

:END
echo.
pause

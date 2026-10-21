@echo off
cd /d "%~dp0"
py -3 client_agent.py
if errorlevel 1 pause

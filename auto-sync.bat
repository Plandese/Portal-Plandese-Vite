@echo off
cd /d "%~dp0"
git add -A
git diff --cached --quiet && (echo Sem alteracoes para commitar.) || (
  git commit -m "auto-sync: %date% %time%"
  git push
  echo Sincronizado com o GitHub!
)
pause

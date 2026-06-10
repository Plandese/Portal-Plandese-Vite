# Registar tarefa agendada de auto-sync
$scriptPath = "C:\Users\david\Desktop\Portal-Plandese-Vite\auto-sync.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 30) -Once -At (Get-Date)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -RestartCount 0
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask -TaskName "Portal-Plandese-AutoSync" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force

Write-Host "Tarefa agendada criada! O projeto vai sincronizar com o GitHub de 30 em 30 minutos." -ForegroundColor Green

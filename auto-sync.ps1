# Auto-sync Portal-Plandese-Vite -> GitHub
$projectPath = "C:\Users\david\Desktop\Portal-Plandese-Vite"
Set-Location $projectPath

# Remover lock files se existirem
$locks = @(".git\index.lock", ".git\HEAD.lock", ".git\objects\maintenance.lock")
foreach ($lock in $locks) {
    if (Test-Path $lock) { Remove-Item $lock -Force }
}

# Verificar se há alterações
$status = git status --porcelain
if ($status) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    git add -A
    git commit -m "auto-sync: $timestamp"
    git push
    Write-Output "[$timestamp] Sincronizado com GitHub."
} else {
    Write-Output "[$(Get-Date -Format 'HH:mm')] Sem alteracoes para sincronizar."
}

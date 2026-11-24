# Lance le serveur du Narrateur et le relance s'il s'arrête.
# Démarré automatiquement à l'ouverture de session par la tâche « Narrateur de jeux »
# (voir scripts/installer-demarrage.ps1). Journal : logs/serveur.log
$ErrorActionPreference = "Continue"
$projet = Split-Path -Parent $PSScriptRoot
Set-Location $projet
$logs = Join-Path $projet "logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$journal = Join-Path $logs "serveur.log"

while ($true) {
  # Le journal est remis à zéro quand il dépasse 5 Mo.
  if ((Test-Path $journal) -and ((Get-Item $journal).Length -gt 5MB)) { Clear-Content $journal }
  Add-Content $journal "[$(Get-Date -Format s)] Démarrage du serveur" -Encoding UTF8
  # cmd écrit la sortie de Node telle quelle (UTF-8) dans le journal.
  # Chemins relatifs (dossier du projet) : pas de guillemets à gérer pour cmd.
  cmd /c "node --env-file=.env.local server.mjs >> logs\serveur.log 2>&1"
  Add-Content $journal "[$(Get-Date -Format s)] Le serveur s'est arrêté (code $LASTEXITCODE). Relance dans 5 s." -Encoding UTF8
  Start-Sleep -Seconds 5
}

# Installe (ou réinstalle) la tâche Windows qui lance le Narrateur à l'ouverture de session.
# Pour la retirer : Unregister-ScheduledTask -TaskName "Narrateur de jeux" -Confirm:$false
$nom = "Narrateur de jeux"
$script = Join-Path $PSScriptRoot "serveur-auto.ps1"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$declencheur = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$reglages = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nom -Action $action -Trigger $declencheur -Settings $reglages `
  -Principal $principal -Description "Serveur du Narrateur de jeux (traduction + narration), relancé automatiquement." -Force | Out-Null
Write-Output "Tâche « $nom » installée."

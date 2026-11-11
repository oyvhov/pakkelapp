param(
    [string]$Destination = ('G:/My Drive/Pakkelapp ' + [char]0x2013 + ' backup')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = (Get-Command python.exe -ErrorAction Stop).Source
$pythonWindowless = Join-Path (Split-Path -Parent $python) 'pythonw.exe'
if (!(Test-Path -LiteralPath $pythonWindowless)) {
    throw 'pythonw.exe is required to run the backup without opening a console.'
}
if (!(Test-Path -LiteralPath $Destination -PathType Container)) {
    throw "Google Drive folder is unavailable: $Destination"
}
$script = Join-Path $PSScriptRoot 'backup-to-drive.py'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $pythonWindowless -Argument "`"$script`" --destination `"$Destination`"" -WorkingDirectory $projectRoot
$triggers = @(
    (New-ScheduledTaskTrigger -Daily -At '04:45'),
    (New-ScheduledTaskTrigger -AtLogOn -User $user)
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -RestartCount 6 -RestartInterval (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Pakkelapp - Google Drive backup' -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Copies the nightly PocketBase snapshot, app source and deployment configuration to Google Drive. Keeps seven days and the latest older backup per week. Also runs after sign-in and retries failures.' -Force

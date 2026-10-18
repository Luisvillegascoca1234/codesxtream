param([switch]$VistaPrevia, [switch]$Revertir)
$ErrorActionPreference = 'Stop'
$originalName = '{A1513480-4333-4DD7-B3B3-3F415A41AB6C}'
$expectedProgram = 'C:\users\pc\appdata\roaming\fnm\node-versions\v24.18.0\installation\node.exe'
$group = 'XtremeVille-iPhone-Scoped-Repair'
$backupFile = Join-Path $PSScriptRoot '.iphone-firewall-backup.json'
$statusFile = Join-Path $PSScriptRoot '.iphone-firewall-result.json'
$outsidePorts = @('1-2999', '3001-65535')
$cloneNames = @('XtremeVille-Node-3000-OtherRemotes', 'XtremeVille-Node-3000-OtherLocalIPs')
$commonOutside = @('0.0.0.0/1', '128.0.0.0/2', '224.0.0.0/3', '208.0.0.0/4', '200.0.0.0/5', '196.0.0.0/6', '194.0.0.0/7', '193.0.0.0/8', '192.0.0.0/9', '192.192.0.0/10', '192.128.0.0/11', '192.176.0.0/12', '192.160.0.0/13', '192.172.0.0/14', '192.170.0.0/15', '192.169.0.0/16', '192.168.128.0/17', '192.168.64.0/18', '192.168.32.0/19', '192.168.16.0/20', '192.168.8.0/21', '192.168.4.0/22', '192.168.2.0/23', '192.168.1.0/24')
$outsidePhone = $commonOutside + @('192.168.0.0/25', '192.168.0.128/26', '192.168.0.224/27', '192.168.0.208/28', '192.168.0.200/29', '192.168.0.192/30', '192.168.0.196/31', '192.168.0.198/32', '::/1', '8000::/1')
$outsidePC = $commonOutside + @('192.168.0.128/25', '192.168.0.64/26', '192.168.0.32/27', '192.168.0.16/28', '192.168.0.8/29', '192.168.0.0/30', '192.168.0.4/31', '192.168.0.7/32', '::/1', '8000::/1')

if ($VistaPrevia) {
  [ordered]@{
    OriginalRule = $originalName
    Program = $expectedProgram
    AllowedException = 'TCP, PC 192.168.0.6:3000, iPhone 192.168.0.199'
    ExistingBlockRetainedOnPorts = $outsidePorts
    AdditionalBlocks = @(
      @{ Name = $cloneNames[0]; Port = 3000; RemoteAddress = $outsidePhone },
      @{ Name = $cloneNames[1]; Port = 3000; LocalAddress = $outsidePC }
    )
    Backup = $backupFile
    ChangesFirewallProfiles = $false
  } | ConvertTo-Json -Depth 6
  exit 0
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Clic derecho en reparar-iphone.cmd > Ejecutar como administrador.'
  exit 1
}

function Write-Result([bool]$success, [string]$message) {
  @{ ok = $success; message = $message; time = [DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $statusFile -Encoding UTF8
}

try {
  $original = Get-NetFirewallRule -PolicyStore PersistentStore -Name $originalName -ErrorAction Stop
  $application = $original | Get-NetFirewallApplicationFilter
  $port = $original | Get-NetFirewallPortFilter
  if ($application.Program -ine $expectedProgram -or $original.Action -ne 'Block' -or $original.Direction -ne 'Inbound' -or [string]$port.Protocol -notin @('TCP', '6') -or [string]$original.Profile -ne 'Public') {
    throw 'La regla original cambio o no corresponde a Node.js. No se modifico.'
  }
  $backup = $null
  if (Test-Path -LiteralPath $backupFile) {
    $backup = Get-Content -LiteralPath $backupFile -Raw | ConvertFrom-Json
    if ($backup.originalName -ne $originalName -or $backup.program -ine $expectedProgram) {
      throw 'La copia de seguridad no coincide. No se modifico el firewall.'
    }
  }
  foreach ($name in $cloneNames) {
    $existingClone = Get-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue
    if ($existingClone -and $existingClone.Group -ne $group) {
      # Recover only a clone recorded in our backup and left by an interrupted copy.
      $cloneApp = $existingClone | Get-NetFirewallApplicationFilter
      if ($backup -and @($backup.clones) -contains $name -and -not $existingClone.Group -and $existingClone.DisplayName -eq 'node.exe' -and $cloneApp.Program -ieq $expectedProgram -and $existingClone.Action -eq 'Block') {
        Remove-NetFirewallRule -PolicyStore PersistentStore -Name $name
      } else { throw 'Hay una regla con el mismo nombre y otro propietario.' }
    }
  }

  if ($Revertir) {
    if (-not $backup) { throw 'No existe copia de seguridad de este ajuste.' }
    $currentPorts = @($port.LocalPort) -join ','
    if ($currentPorts -ne ($outsidePorts -join ',') -and $currentPorts -ne (@($backup.localPorts) -join ',')) {
      throw 'Los puertos fueron modificados por otra herramienta. No se sobrescribieron.'
    }
    Set-NetFirewallRule -PolicyStore PersistentStore -Name $originalName -LocalPort @($backup.localPorts) | Out-Null
    foreach ($name in $cloneNames) { Remove-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $backupFile
    Write-Result $true 'Bloqueo original de Node.js restaurado.'
    exit 0
  }

  if (-not (Get-NetIPAddress -InterfaceAlias Ethernet -AddressFamily IPv4 -IPAddress '192.168.0.6' -ErrorAction SilentlyContinue)) {
    throw 'La direccion del PC cambio. No se aplico este ajuste.'
  }
  $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop | Select-Object -First 1
  $appProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  $entryFile = Join-Path $PSScriptRoot 'server.mjs'
  if ($appProcess.Name -ne 'node.exe' -or -not $appProcess.CommandLine.Contains($entryFile)) {
    throw 'El puerto 3000 no corresponde a esta app.'
  }
  $parent = Get-Item -LiteralPath (Split-Path -Parent $appProcess.ExecutablePath)
  $canonicalProgram = if ($parent.LinkType -eq 'Junction') {
    Join-Path ([string]@($parent.Target)[0]) 'node.exe'
  } else { $appProcess.ExecutablePath }
  if ($canonicalProgram -ine $expectedProgram) { throw 'La app usa otra instalacion de Node.js. No se modifico una regla ajena.' }

  $allow = Get-NetFirewallRule -PolicyStore ActiveStore -Name 'XtremeVille-LAN-3000-19216806' -ErrorAction Stop
  if ($allow.Action -ne 'Allow' -or $allow.Enabled -ne 'True') { throw 'Primero falta el permiso local de XtremeVille.' }
  if (-not $backup) {
    if ([string]$port.LocalPort -ne 'Any') { throw 'La regla tiene puertos personalizados. No se sobrescribieron.' }
    $addresses = $original | Get-NetFirewallAddressFilter
    if ([string]$addresses.LocalAddress -ne 'Any' -or [string]$addresses.RemoteAddress -ne 'Any') {
      throw 'La regla tiene direcciones personalizadas. No se sobrescribieron.'
    }
    @{ originalName = $originalName; program = $expectedProgram; localPorts = @($port.LocalPort); clones = $cloneNames } |
      ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $backupFile -Encoding UTF8
  } elseif ((@($port.LocalPort) -join ',') -ne ($outsidePorts -join ',') -and [string]$port.LocalPort -ne 'Any') {
    throw 'La regla fue modificada desde el ultimo ajuste. No se sobrescribio.'
  }

  # Install compensating blocks BEFORE narrowing the original block.
  # This keeps port 3000 blocked for all other source and destination addresses.
  for ($index = 0; $index -lt $cloneNames.Count; $index++) {
    $name = $cloneNames[$index]
    $localScope = if ($index -eq 0) { @('Any') } else { $outsidePC }
    $remoteScope = if ($index -eq 0) { $outsidePhone } else { @('Any') }
    if (-not (Get-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -PolicyStore PersistentStore -Name $name -DisplayName $name -Group $group -Direction Inbound -Action Block -Enabled True -Profile Public -Program $expectedProgram -Protocol TCP -LocalPort 3000 -LocalAddress $localScope -RemoteAddress $remoteScope | Out-Null
    } else {
      Set-NetFirewallRule -PolicyStore PersistentStore -Name $name -Direction Inbound -Action Block -Enabled True -Profile Public -Program $expectedProgram -Protocol TCP -LocalPort 3000 -LocalAddress $localScope -RemoteAddress $remoteScope | Out-Null
    }
  }
  foreach ($name in $cloneNames) {
    $clone = Get-NetFirewallRule -PolicyStore ActiveStore -Name $name -ErrorAction Stop
    if ($clone.Action -ne 'Block' -or $clone.Enabled -ne 'True') { throw 'No se verificaron los bloqueos de compensacion.' }
  }
  Set-NetFirewallRule -PolicyStore PersistentStore -Name $originalName -LocalPort $outsidePorts | Out-Null
  $verifiedPorts = (Get-NetFirewallRule -PolicyStore ActiveStore -Name $originalName | Get-NetFirewallPortFilter).LocalPort
  if ((@($verifiedPorts) -join ',') -ne ($outsidePorts -join ',')) { throw 'No se pudo verificar el ajuste de puertos.' }
  Write-Result $true 'Excepcion aplicada: solo iPhone 192.168.0.199 hacia PC 192.168.0.6:3000.'
  Write-Host 'Ajuste aplicado y verificado. Vuelve a cargar http://192.168.0.6:3000 en Safari.'
} catch {
  Write-Result $false ($_.Exception.Message + ' (linea ' + $_.InvocationInfo.ScriptLineNumber + ')')
  Write-Host ('No se completo el ajuste: ' + $_.Exception.Message)
  exit 1
}

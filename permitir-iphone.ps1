param([switch]$VistaPrevia, [switch]$Revertir)
$ErrorActionPreference = 'Stop'

# Only this PC address, Ethernet interface, TCP port and home subnet are allowed.
# No router settings, firewall profiles or unrelated rules are modified.
$ruleName = 'XtremeVille-LAN-3000-19216806'
$ruleDisplayName = 'XtremeVille - iPhone en red local'
$ruleDescription = 'Prueba local XtremeVille: TCP 3000 en 192.168.0.6 desde 192.168.0.0/24 por Ethernet.'
$parameters = @{
  Name = $ruleName
  DisplayName = $ruleDisplayName
  Description = $ruleDescription
  Direction = 'Inbound'
  Action = 'Allow'
  Enabled = 'True'
  Protocol = 'TCP'
  LocalPort = '3000'
  LocalAddress = '192.168.0.6'
  RemoteAddress = '192.168.0.0/24'
  InterfaceAlias = 'Ethernet'
  Profile = @('Public', 'Private')
  EdgeTraversalPolicy = 'Block'
}

if ($VistaPrevia) {
  $parameters | ConvertTo-Json
  exit 0
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Windows requiere permiso de administrador para este ajuste.'
  Write-Host 'Clic derecho en permitir-iphone.cmd > Ejecutar como administrador.'
  exit 1
}

try {
  $existing = Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -ErrorAction SilentlyContinue
  if ($existing -and ($existing.DisplayName -ne $ruleDisplayName -or $existing.Description -ne $ruleDescription)) {
    throw 'Existe una regla con el mismo identificador y otro propietario. No se modifico.'
  }
  if ($Revertir) {
    if ($existing) { Remove-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName }
    Write-Host 'Permiso de XtremeVille eliminado. No se modificaron otras reglas.'
    exit 0
  }

  $address = Get-NetIPAddress -InterfaceAlias 'Ethernet' -AddressFamily IPv4 -IPAddress '192.168.0.6' -ErrorAction SilentlyContinue
  if (-not $address -or $address.PrefixLength -ne 24) {
    throw 'La IP o la subred del PC cambio. No se aplico ninguna regla; revisa la nueva direccion antes de continuar.'
  }
  if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
    throw 'La app no esta iniciada. Ejecuta iniciar.cmd y vuelve a intentar.'
  }
  if ($existing) {
    $updateParameters = $parameters.Clone()
    $updateParameters.Remove('Name')
    $updateParameters.Remove('DisplayName')
    $existing | Set-NetFirewallRule @updateParameters | Out-Null
  }
  else { New-NetFirewallRule @parameters | Out-Null }

  $installed = Get-NetFirewallRule -PolicyStore ActiveStore -Name $ruleName -ErrorAction Stop
  $portFilter = $installed | Get-NetFirewallPortFilter
  $addressFilter = $installed | Get-NetFirewallAddressFilter
  if ($installed.Enabled -ne 'True' -or $installed.Action -ne 'Allow' -or $portFilter.LocalPort -ne '3000' -or ($addressFilter.RemoteAddress -notcontains '192.168.0.0/255.255.255.0' -and $addressFilter.RemoteAddress -notcontains '192.168.0.0/24')) {
    throw 'La regla no pudo verificarse. Revisa el firewall de Windows.'
  }
  Write-Host ''
  Write-Host 'Permiso local agregado y verificado. El firewall sigue activo.'
  Write-Host 'En Safari, abre exactamente: http://192.168.0.6:3000'
  Write-Host 'El iPhone debe estar en la misma red domestica, sin aislamiento de clientes.'
  Write-Host ''
  Write-Host 'Si sigue sin abrir, no desactives el firewall: puede haber un bloqueo previo o aislamiento en el router.'
} catch {
  Write-Host ('No se completo el ajuste: ' + $_.Exception.Message)
  exit 1
}

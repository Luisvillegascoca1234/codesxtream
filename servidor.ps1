param([ValidateSet('iniciar', 'detener')][string]$Accion = 'iniciar')
$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$entryFile = Join-Path $appRoot 'server.mjs'
$stateFile = Join-Path $appRoot '.local-runtime.json'
$savedState = $null
if (Test-Path -LiteralPath $stateFile) {
  try { $savedState = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json } catch { }
}
$running = $null
if ($savedState -and $savedState.processId) {
  $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$savedState.processId)"
  if ($candidate -and $candidate.Name -eq 'node.exe' -and $candidate.CommandLine -and $candidate.CommandLine.Contains($entryFile)) {
    $running = $candidate
  }
}
if ($Accion -eq 'detener') {
  if ($running) {
    Stop-Process -Id $running.ProcessId
    Write-Host 'Servidor detenido. Las credenciales en memoria se han eliminado.'
  } else { Write-Host 'No hay un servidor iniciado por este lanzador.' }
  if (Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile }
  exit 0
}
if ($running) { Write-Host "La app ya esta iniciada: http://localhost:$($savedState.port)"; exit 0 }
if ($env:TLS_KEY_FILE -or $env:TLS_CERT_FILE) { throw 'Para iniciar con certificados HTTPS usa npm.cmd start en la consola. Este lanzador corresponde a la prueba HTTP local.' }
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Instala Node.js 22 o superior antes de iniciar.' }
Push-Location -LiteralPath $appRoot
try {
  if (-not (Test-Path -LiteralPath 'node_modules/hls.js/dist/hls.min.js')) {
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias.' }
  }
  $appPort = if ($env:PORT) { [int]$env:PORT } else { 3000 }
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $appPort)
  try { $listener.Start() } catch { throw "El puerto $appPort esta ocupado. Cierra el otro servidor o cambia PORT." } finally { $listener.Stop() }
  $process = Start-Process -FilePath $nodeCommand.Source -ArgumentList @(('"' + $entryFile + '"')) -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru
  @{ processId = $process.Id; port = $appPort } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if ($process.HasExited) { throw 'El servidor no pudo iniciar.' }
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$appPort/api/health" -TimeoutSec 1
      if ($health.ok) { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 200 }
  }
  if (-not $ready) { Stop-Process -Id $process.Id; throw 'El servidor no respondio a la comprobacion de inicio.' }
  Write-Host "App iniciada: http://localhost:$appPort"
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)' } |
    ForEach-Object { Write-Host "Red local: http://$($_.IPAddress):$appPort" }
  Write-Host 'Para detener: doble clic en detener.cmd'
} finally { Pop-Location }

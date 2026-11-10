param(
    [Parameter(Mandatory = $true)]
    [string]$Url
)

# Sempre roda a partir da pasta do projeto
Set-Location $PSScriptRoot

$repo = "https://github.com/rs2508018-ai/DESENHO-OLX.git"
$config = Join-Path $PSScriptRoot "config.json"

# 1) Troca o urlBase no config.json (mexe so nessa linha)
$texto = [System.IO.File]::ReadAllText($config)
$texto = [System.Text.RegularExpressions.Regex]::Replace(
    $texto,
    '("urlBase"\s*:\s*")[^"]*(")',
    { param($m) $m.Groups[1].Value + $Url + $m.Groups[2].Value }
)
[System.IO.File]::WriteAllText($config, $texto)
Write-Host "urlBase trocado para: $Url" -ForegroundColor Green

# 2) Garante que o repositorio e o remoto existem
if (-not (Test-Path (Join-Path $PSScriptRoot ".git"))) {
    git init -b main
}
$temRemoto = git remote
if (-not $temRemoto) {
    git remote add origin $repo
}

# 3) Commit e envio (respeita o .gitignore)
git add -A
git commit -m "Atualiza urlBase para $Url"
git push -u origin main --force

Write-Host "Enviado para o GitHub." -ForegroundColor Green

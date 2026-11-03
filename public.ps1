# Makes the website Live for everyone: runs the analysis server on this PC, opens a Cloudflare quick tunnel
# to it (a public https address), and publishes that address to the repository, where the website looks it
# up on every visit. Run it by double-clicking Start-Public.bat. Close it (Enter) to go back to demo mode.
#
# While it runs, anyone with the website link can upload schematics and use this PC's GPU (Qwen3-VL) and
# MATLAB. Opening MATLAB on this PC's screen is refused for remote visitors.

param(
    [string]$Owner = 'aditya2885',
    [string]$Repo = 'ai-circuit-schematic-reader'
)

$ErrorActionPreference = 'Stop'
# Everything this window shows is also saved to public.log next to this script, for troubleshooting.
try { Start-Transcript -Path (Join-Path $PSScriptRoot 'public.log') -Force | Out-Null } catch { }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Windows PowerShell 5.1 prefixes piped text with a byte-order mark, which git cannot parse.
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = New-Object System.Text.UTF8Encoding $false

$Root = $PSScriptRoot
$Local = 'http://127.0.0.1:8000'
$SiteUrl = "https://$Owner.github.io/$Repo/"
$CfDir = Join-Path $Root 'tools_cloudflared'
$Cf = Join-Path $CfDir 'cloudflared.exe'
$CfLog = Join-Path $env:TEMP 'schematic-reader-tunnel.log'

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ''; Write-Host "ERROR: $text" -ForegroundColor Red; exit 1 }
function Healthy($base) { try { (Invoke-RestMethod "$base/api/health" -TimeoutSec 8).ok } catch { $false } }

function Api($Method, $Path, $Body) {
    $params = @{ Method = $Method; Uri = "https://api.github.com$Path"; Headers = $script:Headers }
    if ($Body) { $params.Body = ($Body | ConvertTo-Json -Depth 6); $params.ContentType = 'application/json' }
    Invoke-RestMethod @params
}
function StatusOf($err) { try { [int]$err.Exception.Response.StatusCode } catch { 0 } }

# Writes {"url": ...} to backend.json on the 'live' branch (the website reads it through the GitHub API).
function Publish-Address($url) {
    try { $null = Api GET "/repos/$Owner/$Repo/branches/live" }
    catch {
        if ((StatusOf $_) -ne 404) { throw }
        $main = Api GET "/repos/$Owner/$Repo/git/ref/heads/main"
        $null = Api POST "/repos/$Owner/$Repo/git/refs" @{ ref = 'refs/heads/live'; sha = $main.object.sha }
    }
    $sha = $null
    try { $sha = (Api GET "/repos/$Owner/$Repo/contents/backend.json?ref=live").sha } catch { if ((StatusOf $_) -ne 404) { throw } }
    $json = (@{ url = $url; updated = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress)
    $body = @{ message = $(if ($url) { 'Analysis server online' } else { 'Analysis server offline' }); branch = 'live'
               content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)) }
    if ($sha) { $body.sha = $sha }
    $null = Api PUT "/repos/$Owner/$Repo/contents/backend.json" $body
}

# ------------------------------------------------------------------ GitHub (to publish the address)
Step 'GitHub sign-in'
$filled = & { $ErrorActionPreference = 'Continue'; "protocol=https`nhost=github.com`n`n" | git.exe credential fill }
$token = ($filled | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
if (-not $token) { Fail 'Not signed in to GitHub. Run github-login.bat first.' }
$script:Headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'schematic-reader-public'; Accept = 'application/vnd.github+json' }
try { $me = Api GET '/user' } catch { Fail 'GitHub did not accept the saved sign-in. Run github-login.bat, then try again.' }
Write-Host "Signed in as $($me.login)."

# ------------------------------------------------------------------ analysis server
Step 'Analysis server'
if (Healthy $Local) { Write-Host "Already running on $Local." }
else {
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Fail 'Python 3.11+ is required: https://www.python.org/downloads/' }
    Start-Process cmd -ArgumentList '/k', 'title Schematic Reader server && python server\app.py' -WorkingDirectory $Root
    Write-Host 'Starting (a server window opens; keep it open)...'
    for ($i = 0; $i -lt 30 -and -not (Healthy $Local); $i++) { Start-Sleep -Seconds 2 }
    if (-not (Healthy $Local)) { Fail "The server did not start. Look at the server window for the error." }
}
$h = Invoke-RestMethod "$Local/api/health"
Write-Host ("Ollama: {0}   MATLAB: {1}" -f $(if ($h.ollama.ok) { 'ok' } else { 'NOT RUNNING - start the Ollama app' }), $(if ($h.matlab.ok) { 'ok' } else { 'not found' }))

# ------------------------------------------------------------------ tunnel
Step 'Public tunnel (Cloudflare)'
if (-not (Test-Path $Cf)) {
    Write-Host 'Downloading cloudflared from Cloudflare''s GitHub releases (one time, ~60 MB)...'
    New-Item -ItemType Directory -Force $CfDir | Out-Null
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -UseBasicParsing 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $Cf
}
if (Test-Path $CfLog) { Remove-Item $CfLog -Force }
$CfIn = "$CfLog.in"   # an empty file as the tunnel's input, so it never reads this window's keyboard
Set-Content -Path $CfIn -Value $null
$tunnel = Start-Process $Cf -ArgumentList 'tunnel', '--no-autoupdate', '--url', $Local -RedirectStandardError $CfLog `
    -RedirectStandardOutput "$CfLog.out" -RedirectStandardInput $CfIn -WindowStyle Hidden -PassThru
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $CfLog) {
        $m = Select-String -Path $CfLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value }
    }
    if ($tunnel.HasExited) { break }
}
if (-not $url) { Fail "The tunnel did not start. Details: $CfLog" }
Write-Host "Public address: $url"
Write-Host 'Waiting until it answers from the internet (up to a minute)...'
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) { Start-Sleep -Seconds 3; $ok = Healthy $url }
if (-not $ok) { Write-Host 'It does not answer from this PC yet (new addresses can take a minute to reach every network); publishing it anyway.' -ForegroundColor Yellow }

# ------------------------------------------------------------------ publish
Step 'Telling the website where the server is'
Publish-Address $url
Write-Host ''
Write-Host 'LIVE for everyone:' -ForegroundColor Green
Write-Host "  $SiteUrl" -ForegroundColor Green
Write-Host 'Anyone opening that link now gets Live mode (allow up to a minute). Keep this window and the server window open.'
Write-Host 'To stop sharing: press Ctrl+C here, or close this window (the website then falls back to demo mode by itself).'
Write-Host ''
# No Read-Host here: the tunnel process shares this console and its input, which made a prompt return at once.
# Instead stay up while the tunnel runs, and report every minute whether the server still answers.
try {
    $down = $false
    while (-not $tunnel.HasExited) {
        Start-Sleep -Seconds 60
        $up = Healthy $url
        if ($up -and $down) { Write-Host "$(Get-Date -Format HH:mm) Server answering again." -ForegroundColor Green }
        if (-not $up -and -not $down) { Write-Host "$(Get-Date -Format HH:mm) The server is not answering. Is the server window still open?" -ForegroundColor Yellow }
        $down = -not $up
    }
    Write-Host 'The tunnel stopped. Run Start-Public.bat again to go live.' -ForegroundColor Yellow
}
finally {
    Write-Host 'Stopping sharing...'
    if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
    try { Publish-Address $null; Write-Host 'The website is back in demo mode.' } catch { Write-Host 'Could not reset the website address; it falls back to demo mode by itself.' }
}

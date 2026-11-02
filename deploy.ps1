# Publishes AI Circuit Schematic Reader to GitHub, and its website to GitHub Pages.
#
# Run it by double-clicking deploy.bat. You approve twice:
#   1. the list of files that will be published (publicly), in this window;
#   2. the GitHub sign-in, in your browser (Git Credential Manager handles it; this script never sees
#      your password).
# It then creates the repository if needed, pushes the code, builds the website, pushes it to the
# gh-pages branch, turns on GitHub Pages and opens the site. Safe to run again to publish updates.

param(
    [string]$Owner = 'aditya2885',
    [string]$Repo = 'ai-circuit-schematic-reader',
    [switch]$DryRun,  # list the files that would be published, then stop
    [switch]$Login    # sign out of GitHub and sign in again (github-login.bat), then stop
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = $PSScriptRoot
$Work = Join-Path $Root '_publish'
$Stage = Join-Path $Work 'repo'
$SiteDir = Join-Path $Work 'site'
$SiteGit = Join-Path $Work 'site-git'
$RepoUrl = "https://github.com/$Owner/$Repo"
$GitUrl = "$RepoUrl.git"
$SiteUrl = "https://$Owner.github.io/$Repo/"

# What is published: the app, the reader, the Simulink builder and the training notebook. Never the
# datasets, model weights, analysis outputs or anything else in the project folder.
$Dirs = @('server', 'web', 'context\schematic-reader', 'simulink', 'training')
$Files = @('README.md', 'Start-SchematicReader.bat', 'deploy.bat', 'github-login.bat', 'deploy.ps1')
$SkipDirs = @('node_modules', 'dist', 'dist-pages', '__pycache__', 'out', '.vite')
$SkipFiles = @('*.pyc', '.env', '.env.local', '*.zip', '*.log')

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ''; Write-Host "ERROR: $text" -ForegroundColor Red; exit 1 }
function Invoke-Git { & git.exe @args; if ($LASTEXITCODE -ne 0) { Fail "git $($args -join ' ') failed." } }

function Api($Method, $Path, $Body) {
    $params = @{ Method = $Method; Uri = "https://api.github.com$Path"; Headers = $script:Headers }
    if ($Body) { $params.Body = ($Body | ConvertTo-Json -Depth 6); $params.ContentType = 'application/json' }
    Invoke-RestMethod @params
}
function StatusOf($err) { try { [int]$err.Exception.Response.StatusCode } catch { 0 } }

# GitHub sign-in goes through Git Credential Manager: it opens github.com in the browser, you sign in and
# click Authorize, and it keeps the result for git. This script only reads the token it hands back.
$env:GCM_GITHUB_AUTHMODES = 'browser'

function Forget-GitHub {
    foreach ($user in @(git credential-manager github list 2>$null)) {
        if ($user) { git credential-manager github logout $user 2>$null | Out-Null; Write-Host "Signed out $user." }
    }
    "protocol=https`nhost=github.com`n`n" | git credential reject 2>$null
}

function Sign-In {
    for ($try = 1; $try -le 2; $try++) {
        Write-Host "Your browser opens GitHub: sign in as '$Owner' and click Authorize, then come back here."
        $filled = "protocol=https`nhost=github.com`n`n" | git credential fill
        if ($LASTEXITCODE -ne 0 -or -not $filled) { Fail 'GitHub sign-in was cancelled or failed. Run github-login.bat to try again.' }
        $token = ($filled | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
        $script:Headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'schematic-reader-deploy'; Accept = 'application/vnd.github+json' }
        $me = $null
        try { $me = Api GET '/user' } catch { }
        if (-not $me) { Write-Host 'GitHub did not accept that sign-in; signing in again.' -ForegroundColor Yellow; Forget-GitHub; continue }
        if ($me.login -ne $Owner) {
            Write-Host "That is the account '$($me.login)', not '$Owner'. Signing it out so you can sign in as '$Owner'." -ForegroundColor Yellow
            Forget-GitHub
            continue
        }
        "protocol=https`nhost=github.com`nusername=$($me.login)`npassword=$token`n`n" | git credential approve
        Write-Host "Signed in to GitHub as $($me.login)." -ForegroundColor Green
        return $me
    }
    Fail "Could not sign in as '$Owner'. Run github-login.bat, sign in as '$Owner', then run deploy.bat."
}

# ------------------------------------------------------------------ tools
Step 'Checking tools'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'Git is not installed: https://git-scm.com/download/win' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $portable = Get-ChildItem (Join-Path $Root 'tools_node') -Directory -Filter 'node-v*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($portable) { $env:PATH = "$($portable.FullName);$env:PATH" }
    else { Fail 'Node.js is needed to build the website: https://nodejs.org (LTS).' }
}
Write-Host "git $((git --version) -replace 'git version ','') | node $(node --version)"

if ($Login) {
    Step 'Signing in to GitHub again'
    Forget-GitHub
    $null = Sign-In
    Write-Host 'Now double-click deploy.bat to publish.'
    exit 0
}

# ------------------------------------------------------------------ approval 1: the files
Step "Files to publish to $RepoUrl (public)"
# Walk the folders without descending into skipped ones (node_modules alone holds thousands of files).
function Collect($dir) {
    foreach ($item in Get-ChildItem $dir -Force) {
        if ($item.PSIsContainer) { if ($SkipDirs -notcontains $item.Name) { Collect $item.FullName } }
        elseif (-not ($SkipFiles | Where-Object { $item.Name -like $_ })) { $item }
    }
}
$list = foreach ($d in $Dirs) { $base = Join-Path $Root $d; if (Test-Path $base) { Collect $base } }
$list = @($list) + @($Files | ForEach-Object { Get-Item (Join-Path $Root $_) -ErrorAction SilentlyContinue } | Where-Object { $_ })
$list | Group-Object { $_.FullName.Substring($Root.Length + 1).Split('\')[0] } | ForEach-Object {
    '{0,-28} {1,5} files  {2,8:N0} KB' -f $_.Name, $_.Count, (($_.Group | Measure-Object Length -Sum).Sum / 1KB)
} | Write-Host
$totalMb = ($list | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("Total: {0} files, {1:N1} MB. Not included: datasets, model weights, server_data, simulink\out, node_modules." -f $list.Count, $totalMb)
if ($DryRun) { $list | ForEach-Object { $_.FullName.Substring($Root.Length + 1) }; Write-Host 'Dry run: nothing was published.'; exit 0 }
$answer = Read-Host "Publish these files PUBLICLY to $RepoUrl and the website to $SiteUrl ? Type Y to continue"
if ($answer -notmatch '^[Yy]') { Write-Host 'Cancelled. Nothing was published.'; exit 0 }

# ------------------------------------------------------------------ approval 2: GitHub sign-in
Step 'Signing in to GitHub'
$me = Sign-In

# ------------------------------------------------------------------ repository
Step "Repository $Owner/$Repo"
$exists = $true
try { $null = Api GET "/repos/$Owner/$Repo" } catch { if ((StatusOf $_) -eq 404) { $exists = $false } else { throw } }
if (-not $exists) {
    $null = Api POST '/user/repos' @{
        name = $Repo; private = $false; has_wiki = $false; homepage = $SiteUrl
        description = 'AI Circuit Schematic Reader: circuit image -> Qwen3-VL netlist -> MATLAB Simulink model, with a conversational web workspace.'
    }
    Write-Host 'Created.'
} else { Write-Host 'Already exists; publishing an update.' }

# ------------------------------------------------------------------ code -> main
Step 'Pushing the code (main branch)'
New-Item -ItemType Directory -Force $Work | Out-Null
if (-not (Test-Path (Join-Path $Stage '.git'))) {
    if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
    $remoteMain = git ls-remote --heads $GitUrl main 2>$null
    if ($remoteMain) { Invoke-Git clone --quiet $GitUrl $Stage } else { New-Item -ItemType Directory -Force $Stage | Out-Null; Invoke-Git -C $Stage init --quiet -b main }
}
Get-ChildItem $Stage -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force
foreach ($f in $list) {
    $rel = $f.FullName.Substring($Root.Length + 1)
    $dest = Join-Path $Stage $rel
    New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
    Copy-Item $f.FullName $dest -Force
}
@('node_modules/', 'dist/', 'dist-pages/', '__pycache__/', '*.pyc', '.env', '.env.local', 'server_data/', '_publish/', 'simulink/out/', 'tools_node/') |
    Set-Content (Join-Path $Stage '.gitignore') -Encoding ascii
Invoke-Git -C $Stage config user.name $Owner
Invoke-Git -C $Stage config user.email "$Owner@users.noreply.github.com"
Invoke-Git -C $Stage add -A
if (git -C $Stage status --porcelain) { Invoke-Git -C $Stage commit --quiet -m "Publish AI Circuit Schematic Reader ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))" }
else { Write-Host 'No code changes since the last publish.' }
if (git -C $Stage remote) { Invoke-Git -C $Stage remote set-url origin $GitUrl } else { Invoke-Git -C $Stage remote add origin $GitUrl }
Invoke-Git -C $Stage push --quiet -u origin main

# ------------------------------------------------------------------ website -> gh-pages
Step 'Building the website'
Push-Location (Join-Path $Root 'web')
try {
    if (-not (Test-Path 'node_modules')) { & npm install --no-fund --no-audit; if ($LASTEXITCODE -ne 0) { Fail 'npm install failed.' } }
    $env:VITE_API_URL = 'http://127.0.0.1:8000'   # the analysis server runs on the visitor's own PC
    $env:VITE_DEFAULT_MODE = 'auto'               # live when that server answers, demo otherwise
    $env:VITE_HOSTED = '1'
    $env:VITE_REPO_URL = $RepoUrl
    & node node_modules\vite\bin\vite.js build --base "/$Repo/" --outDir $SiteDir --emptyOutDir --logLevel warn
    if ($LASTEXITCODE -ne 0) { Fail 'The website build failed.' }
} finally {
    Remove-Item Env:VITE_API_URL, Env:VITE_DEFAULT_MODE, Env:VITE_HOSTED, Env:VITE_REPO_URL -ErrorAction SilentlyContinue
    Pop-Location
}
New-Item (Join-Path $SiteDir '.nojekyll') -ItemType File -Force | Out-Null

Step 'Pushing the website (gh-pages branch)'
if (Test-Path $SiteGit) { Remove-Item $SiteGit -Recurse -Force }
Copy-Item $SiteDir $SiteGit -Recurse
Invoke-Git -C $SiteGit init --quiet -b gh-pages
Invoke-Git -C $SiteGit config user.name $Owner
Invoke-Git -C $SiteGit config user.email "$Owner@users.noreply.github.com"
Invoke-Git -C $SiteGit add -A
Invoke-Git -C $SiteGit commit --quiet -m 'Website build'
Invoke-Git -C $SiteGit push --quiet --force $GitUrl gh-pages

# ------------------------------------------------------------------ GitHub Pages
Step 'Turning on GitHub Pages'
try { $null = Api POST "/repos/$Owner/$Repo/pages" @{ source = @{ branch = 'gh-pages'; path = '/' } }; Write-Host 'Enabled.' }
catch {
    if ((StatusOf $_) -eq 409) {
        $null = Api PUT "/repos/$Owner/$Repo/pages" @{ source = @{ branch = 'gh-pages'; path = '/' } }
        Write-Host 'Already on; source set to gh-pages.'
    } else { Fail "Could not enable GitHub Pages ($($_.Exception.Message)). Turn it on at $RepoUrl/settings/pages (branch gh-pages)." }
}
try { $null = Api POST "/repos/$Owner/$Repo/pages/builds" } catch { }

Write-Host 'Waiting for GitHub to publish the site (usually under a minute)...'
$state = ''
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 5
    try { $state = (Api GET "/repos/$Owner/$Repo/pages/builds/latest").status } catch { $state = '' }
    if ($state -eq 'built' -or $state -eq 'errored') { break }
}
if ($state -eq 'errored') { Fail "GitHub Pages reported a build error. See $RepoUrl/settings/pages" }

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host "Website:    $SiteUrl" -ForegroundColor Green
Write-Host "Repository: $RepoUrl"
Write-Host 'For live analysis on this PC, run Start-SchematicReader.bat; the website then switches to Live.'
Start-Process $SiteUrl

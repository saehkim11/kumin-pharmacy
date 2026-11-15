[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('erp', 'bi', 'content', 'qa')]
    [string]$Area,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9][a-z0-9-]{1,40}$')]
    [string]$Name
)

$ErrorActionPreference = 'Stop'

$repoRoot = (git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) {
    throw 'Git 저장소 안에서 실행해 주세요.'
}

$currentBranch = (git branch --show-current).Trim()
if ($currentBranch -ne 'main') {
    throw "새 작업공간은 main에서 만듭니다. 현재 브랜치 '$currentBranch' 대신 main 작업공간에서 실행해 주세요."
}

$prefix = if ($Area -eq 'qa') { 'qa' } else { 'feature' }
$branch = "$prefix/$Area-$Name"
$repoItem = Get-Item -LiteralPath $repoRoot
$worktreeRoot = Join-Path $repoItem.Parent.FullName "$($repoItem.Name)-worktrees"
$target = Join-Path $worktreeRoot "$Area-$Name"

if (Test-Path -LiteralPath $target) {
    throw "이미 같은 작업공간이 있습니다: $target"
}

git show-ref --verify --quiet "refs/heads/$branch"
if ($LASTEXITCODE -eq 0) {
    throw "이미 같은 브랜치가 있습니다: $branch. 새 이름을 사용하거나 기존 작업공간을 확인해 주세요."
}

New-Item -ItemType Directory -Force -Path $worktreeRoot | Out-Null
git worktree add -b $branch $target main
if ($LASTEXITCODE -ne 0) {
    throw 'Git Worktree 생성에 실패했습니다. 위의 Git 메시지를 확인해 주세요.'
}

Write-Host ''
Write-Host "작업공간을 만들었습니다: $target"
Write-Host "브랜치: $branch"
Write-Host '다음 순서: 해당 폴더로 이동 → npm ci → 변경 → npm run qa:ci → 커밋 → PR'

param([Parameter(Mandatory = $true)][string]$Tag)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
node scripts/check-project.mjs --tag $Tag
if ($LASTEXITCODE -ne 0) { throw 'Release metadata validation failed.' }
$releaseCommit = git rev-parse --verify "$Tag^{commit}"
if ($LASTEXITCODE -ne 0) { throw 'Release tag must exist locally.' }
$headCommit = git rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $releaseCommit -ne $headCommit) { throw 'HEAD must match the release tag.' }
$workingChanges = git status --porcelain
if ($LASTEXITCODE -ne 0 -or $workingChanges) { throw 'Release requires a clean source checkout.' }

$artifactDirectory = Join-Path $projectRoot 'release/artifacts'
$portableDirectory = Join-Path $projectRoot "release/staging/Proofread-$Tag-windows-x64"
# A fresh staging directory prevents accidentally shipping artifacts from another build.
if (Test-Path -LiteralPath $artifactDirectory) { throw 'release/artifacts already exists; use a clean checkout.' }
if (Test-Path -LiteralPath $portableDirectory) { throw 'Release staging already exists; use a clean checkout.' }
$installers = @(Get-ChildItem -LiteralPath 'src-tauri/target/release/bundle/nsis' -Filter '*.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS installer from a clean build.' }
New-Item -ItemType Directory -Path $artifactDirectory, $portableDirectory -Force | Out-Null
Copy-Item -LiteralPath $installers[0].FullName -Destination "$artifactDirectory/Proofread-$Tag-windows-x64-setup.exe"
Copy-Item -LiteralPath 'src-tauri/target/release/proofread.exe', 'LICENSE', 'NOTICE', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md' -Destination $portableDirectory
Copy-Item -LiteralPath 'docs', 'fixtures' -Destination $portableDirectory -Recurse
Compress-Archive -LiteralPath $portableDirectory -DestinationPath "$artifactDirectory/Proofread-$Tag-windows-x64-portable.zip"
git archive --format=zip "--prefix=Proofreader-$Tag/" "--output=$artifactDirectory/Proofreader-$Tag-source.zip" HEAD
if ($LASTEXITCODE -ne 0) { throw 'Source archive creation failed.' }
Copy-Item -LiteralPath 'LICENSE', 'NOTICE' -Destination $artifactDirectory

$version = $Tag.Substring(1)
$changelog = Get-Content -LiteralPath CHANGELOG.md -Raw
$releaseNotes = [regex]::Match($changelog, "(?ms)^## \[$([regex]::Escape($version))\][^\r\n]*\r?\n(.*?)(?=^## \[|\z)").Groups[1].Value.Trim()
if (-not $releaseNotes) { throw 'No release notes found for this version.' }
$notes = @"
# Proofread $Tag

$releaseNotes

## 下载与运行

- setup.exe：Windows x64 安装包；缺少 WebView2 时需要联网安装运行时。
- portable.zip：解压运行 proofread.exe，需要已安装 WebView2；工作记录仍保存在用户配置目录。
- source.zip：本项目该标签的源码、构建脚本和锁文件；第三方依赖源码另行审查和提供。
- SHA256SUMS.txt：下载文件的 SHA-256 校验值。

许可：GPL-3.0-or-later。当前安装包未进行代码签名，无自动更新。
源码：https://github.com/LightYuki/Proofreader/tree/$Tag

## 发布前验收（草稿）

- [ ] 在干净 Windows 环境完成安装、启动、升级及卸载验收。
- [ ] 用 fixtures 完成导入、校润、人工确认、导出和重启恢复。
- [ ] 按 docs/DEPENDENCIES.md 补齐第三方许可、版权声明及所需对应源码。
- [ ] 核对全部附件与 SHA-256，然后移除本验收段并公开 Release。
"@
Set-Content -LiteralPath "$artifactDirectory/RELEASE_NOTES.md" -Value $notes -Encoding utf8NoBOM
$checksums = Get-ChildItem -LiteralPath $artifactDirectory -File | Sort-Object Name | ForEach-Object {
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $($_.Name)"
}
Set-Content -LiteralPath "$artifactDirectory/SHA256SUMS.txt" -Value $checksums -Encoding ascii

# Launches the Neo4j Cypher MCP server (mcp-neo4j-cypher) using the
# connection settings in .env.local, so credentials live in one git-ignored file.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env.local'

if (-not (Test-Path $envFile)) {
    [Console]::Error.WriteLine("Missing $envFile - copy .env.example to .env.local and fill in your Neo4j settings.")
    exit 1
}

foreach ($line in Get-Content $envFile -Encoding UTF8) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
        $value = $Matches[2].Trim().Trim('"').Trim("'")
        [Environment]::SetEnvironmentVariable($Matches[1], $value, 'Process')
    }
}

# Read-only by default, matching the data-safety rules in AGENTS.md.
if (-not $env:NEO4J_READ_ONLY) { $env:NEO4J_READ_ONLY = 'true' }

# Pick up tools (uvx) installed after this shell's parent process started.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

& uvx --python 3.12 mcp-neo4j-cypher --transport stdio
exit $LASTEXITCODE

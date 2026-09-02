[CmdletBinding()]
param(
  [string]$WorkbookPath = (Join-Path $PSScriptRoot '..\context\Pladesamling opdateret 01.09.2026 (new).xlsx'),
  [string]$CataloguePath = (Join-Path $PSScriptRoot '..\data\vinyls.json')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression

function Get-ZipText([System.IO.Compression.ZipArchive]$Archive, [string]$EntryName) {
  $entry = $Archive.GetEntry($EntryName)
  if (-not $entry) { throw "Workbook entry '$EntryName' was not found." }
  $reader = [System.IO.StreamReader]::new($entry.Open(), [System.Text.Encoding]::UTF8)
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Get-CellText($Cell, [string[]]$SharedStrings) {
  $type = $Cell.GetAttribute('t')
  if ($type -eq 's') { return $SharedStrings[[int]$Cell.SelectSingleNode('./*[local-name()="v"]').InnerText] }
  if ($type -eq 'inlineStr') { return ($Cell.SelectNodes('.//*[local-name()="t"]') | ForEach-Object InnerText) -join '' }
  $value = $Cell.SelectSingleNode('./*[local-name()="v"]')
  if ($value) { return $value.InnerText }
  return ''
}

function Get-ColumnName([string]$CellReference) {
  return ([regex]::Match($CellReference, '^[A-Z]+')).Value
}

function CanonicalNumber($Value) {
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return '' }
  $number = [decimal]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture)
  return $number.ToString('0.############################', [Globalization.CultureInfo]::InvariantCulture)
}

function CanonicalText($Value) {
  if ($null -eq $Value) { return '' }
  return ([string]$Value).Trim()
}

function Fingerprint($Artist, $Title, $Country, $Released, $CatNo, $Price, $Shelf, $Genres) {
  return @(
    (CanonicalText $Artist),
    (CanonicalText $Title),
    (CanonicalText $Country),
    (CanonicalNumber $Released),
    (CanonicalText $CatNo),
    (CanonicalNumber $Price),
    (CanonicalNumber $Shelf),
    (CanonicalText $Genres)
  ) -join [char]31
}

function Add-Count([hashtable]$Counts, [hashtable]$Examples, [string]$Key, [string]$Example) {
  $Counts[$Key] = 1 + [int]($Counts[$Key] ?? 0)
  if (-not $Examples.ContainsKey($Key)) { $Examples[$Key] = $Example }
}

$workbook = Resolve-Path -LiteralPath $WorkbookPath
$catalogue = Resolve-Path -LiteralPath $CataloguePath
$archive = [System.IO.Compression.ZipFile]::OpenRead($workbook)

try {
  [xml]$workbookXml = Get-ZipText $archive 'xl/workbook.xml'
  $mikkelSheet = $workbookXml.SelectSingleNode('//*[local-name()="sheet" and @name="Mikkel"]')
  if (-not $mikkelSheet) { throw "The workbook does not contain a sheet named 'Mikkel'." }
  $relationshipId = ($mikkelSheet.Attributes | Where-Object { $_.LocalName -eq 'id' }).Value

  [xml]$relationshipsXml = Get-ZipText $archive 'xl/_rels/workbook.xml.rels'
  $relationship = $relationshipsXml.SelectSingleNode("//*[local-name()='Relationship' and @Id='$relationshipId']")
  if (-not $relationship) { throw "The Mikkel sheet relationship '$relationshipId' was not found." }
  $sheetEntryName = 'xl/' + $relationship.GetAttribute('Target').TrimStart('/')

  $sharedStrings = @()
  if ($archive.GetEntry('xl/sharedStrings.xml')) {
    [xml]$sharedStringsXml = Get-ZipText $archive 'xl/sharedStrings.xml'
    $sharedStrings = @($sharedStringsXml.SelectNodes('//*[local-name()="si"]') | ForEach-Object {
      ($_.SelectNodes('.//*[local-name()="t"]') | ForEach-Object InnerText) -join ''
    })
  }

  [xml]$sheetXml = Get-ZipText $archive $sheetEntryName
  $rows = @($sheetXml.SelectNodes('//*[local-name()="sheetData"]/*[local-name()="row"]'))
  if ($rows.Count -lt 2) { throw "The Mikkel sheet has no data rows." }

  $header = @{}
  foreach ($cell in $rows[0].SelectNodes('./*[local-name()="c"]')) {
    $header[(Get-ColumnName $cell.GetAttribute('r'))] = Get-CellText $cell $sharedStrings
  }
  foreach ($required in 'Artist', 'Ny hylde', 'AlbumTitle', 'Country', 'Released', 'CatNo', 'Price Record Scanner', 'Genres') {
    if (-not ($header.Values -contains $required)) { throw "Mikkel is missing the '$required' column." }
  }

  $expected = @{}
  $expectedExamples = @{}
  foreach ($row in $rows | Select-Object -Skip 1) {
    $values = @{}
    foreach ($cell in $row.SelectNodes('./*[local-name()="c"]')) {
      $column = Get-ColumnName $cell.GetAttribute('r')
      $values[$header[$column]] = Get-CellText $cell $sharedStrings
    }
    if (($values.Values | Where-Object { $_ -ne '' }).Count -eq 0) { continue }
    $key = Fingerprint $values['Artist'] $values['AlbumTitle'] $values['Country'] $values['Released'] $values['CatNo'] $values['Price Record Scanner'] $values['Ny hylde'] $values['Genres']
    Add-Count $expected $expectedExamples $key "$($values['Artist']) — $($values['AlbumTitle'])"
  }
} finally {
  $archive.Dispose()
}

$actual = @{}
$actualExamples = @{}
foreach ($record in (Get-Content -Raw -LiteralPath $catalogue | ConvertFrom-Json)) {
  $key = Fingerprint $record.artist $record.albumTitle $record.country $record.released $record.catNo $record.discogsPrice $record.shelf $record.genres
  Add-Count $actual $actualExamples $key "$($record.artist) — $($record.albumTitle) (#$($record.id))"
}

$missing = @($expected.Keys | Where-Object { [int]$expected[$_] -gt [int]($actual[$_] ?? 0) })
$extra = @($actual.Keys | Where-Object { [int]$actual[$_] -gt [int]($expected[$_] ?? 0) })
$missingRows = ($missing | ForEach-Object { [int]$expected[$_] - [int]($actual[$_] ?? 0) } | Measure-Object -Sum).Sum ?? 0
$extraRows = ($extra | ForEach-Object { [int]$actual[$_] - [int]($expected[$_] ?? 0) } | Measure-Object -Sum).Sum ?? 0

Write-Output "Mikkel rows: $($expected.Values | Measure-Object -Sum | Select-Object -ExpandProperty Sum)"
Write-Output "vinyls.json rows: $($actual.Values | Measure-Object -Sum | Select-Object -ExpandProperty Sum)"

if ($missingRows -eq 0 -and $extraRows -eq 0) {
  Write-Output 'PASS: vinyls.json contains exactly the Mikkel inventory.'
  exit 0
}

if ($missing.Count) { Write-Output "Missing examples: $((@($missing | Select-Object -First 5 | ForEach-Object { $expectedExamples[$_] }) -join '; '))" }
if ($extra.Count) { Write-Output "Extra examples: $((@($extra | Select-Object -First 5 | ForEach-Object { $actualExamples[$_] }) -join '; '))" }
Write-Error "FAIL: $missingRows missing Mikkel row(s) and $extraRows extra JSON row(s)."
exit 1

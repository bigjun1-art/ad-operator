import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ERROR = /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!)/;
const isFormula = cell => cell !== null && typeof cell === 'object';
export function columnAddress(index) {
  if (!Number.isSafeInteger(index) || index < 1 || index > 16384) throw new Error('Column index must be 1..16384');
  let result = '';
  for (let n = index; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}

function validate(sheets) {
  if (!Array.isArray(sheets) || sheets.length < 4) throw new Error('At least four sheets are required');
  const names = new Set();
  return sheets.map(sheet => {
    if (!sheet || typeof sheet.name !== 'string' || !sheet.name.length || sheet.name.length > 31 || /[\\/\[\]:*?]/.test(sheet.name) || /^'|'$/.test(sheet.name)) throw new Error('Invalid worksheet name');
    if (names.has(sheet.name.toLowerCase())) throw new Error('Duplicate worksheet name');
    names.add(sheet.name.toLowerCase());
    if (!Array.isArray(sheet.rows) || !sheet.rows.length || sheet.rows.length > 1048576 || sheet.rows.some(row => !Array.isArray(row))) throw new Error('Rows must be a nonempty two-dimensional array');
    const columns = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
    columnAddress(columns);
    for (const row of sheet.rows) for (const cell of row) {
      if (cell === null || typeof cell === 'string' || (typeof cell === 'number' && Number.isFinite(cell))) continue;
      if (isFormula(cell) && typeof cell.formula === 'string' && cell.formula.startsWith('=') && cell.formula.length > 1 && (cell.value === null || (typeof cell.value === 'number' && Number.isFinite(cell.value)))) continue;
      throw new Error('Cells must be strings, finite numbers, null, or {formula, value:number|null}');
    }
    if (sheet.headerRows !== undefined && sheet.headerRows !== 1 && sheet.headerRows !== 0) throw new Error('headerRows must be 0 or 1');
    if (sheet.widths !== undefined && (!Array.isArray(sheet.widths) || sheet.widths.length > columns || sheet.widths.some(n => !Number.isFinite(n) || n <= 0 || n > 255))) throw new Error('Invalid column widths');
    return { ...sheet, columns, range: `A1:${columnAddress(columns)}${sheet.rows.length}` };
  });
}

function equal(expected, actual, tolerance) {
  if (expected === null || expected === '') return actual === null || actual === undefined || actual === '';
  return typeof expected === 'number' ? typeof actual === 'number' && Math.abs(expected - actual) <= tolerance * Math.max(1, Math.abs(expected)) : expected === actual;
}

function verifyWorkbook(workbook, specs, tolerance, phase) {
  const mismatches = [];
  const sheets = [];
  for (const spec of specs) {
    const sheet = workbook.worksheets.getItem(spec.name);
    const range = sheet.getRange(spec.range), values = range.values, formulas = range.formulas;
    const used = sheet.getUsedRange().values;
    const actualRows = used.length, actualColumns = used.reduce((max, row) => Math.max(max, row.length), 0);
    let cells = 0, formulaCells = 0, strings = 0;
    if (actualRows !== spec.rows.length || actualColumns !== spec.columns) mismatches.push({ sheet: spec.name, kind: 'dimensions', expected: [spec.rows.length, spec.columns], actual: [actualRows, actualColumns] });
    for (let row = 0; row < spec.rows.length; row++) for (let col = 0; col < spec.columns; col++) {
      cells++;
      const input = spec.rows[row][col] ?? null, formula = isFormula(input) ? input.formula : null;
      const expected = formula ? input.value : input, actual = values[row]?.[col] ?? null;
      const actualFormula = formulas[row]?.[col] || null, cell = `${columnAddress(col + 1)}${row + 1}`;
      if (formula) formulaCells++;
      if (typeof expected === 'string') strings++;
      if ((actualFormula || null) !== formula) mismatches.push({ sheet: spec.name, cell, kind: 'formula', expected: formula, actual: actualFormula });
      if (!equal(expected, actual, tolerance)) mismatches.push({ sheet: spec.name, cell, kind: 'value', expected, actual });
      if (formula && typeof actual === 'string' && ERROR.test(actual)) mismatches.push({ sheet: spec.name, cell, kind: 'formula-error', actual });
    }
    sheets.push({ name: spec.name, rows: spec.rows.length, columns: spec.columns, actualRows, actualColumns, range: spec.range, checkedCells: cells, stringCells: strings, formulaCells });
  }
  return { phase, sheets, mismatches, passed: mismatches.length === 0 };
}

function verificationFailed(checks) {
  const safeChecks = JSON.parse(JSON.stringify(checks, (key, value) => ['expected', 'actual'].includes(key) ? undefined : value));
  throw Object.assign(new Error('Workbook verification failed; output was not published'), { code: 'REPORT_WORKBOOK_VERIFICATION_FAILED', checks: safeChecks });
}

/** Export four or more caller-owned report tables and verify every cell after reopening.
 * Strings are always literal text, including source strings beginning with '='.
 * Formula.value is an independent expected result; it is never written into the cell.
 * artifactModule is an optional module URL or absolute entry path, configured privately.
 * Output and support file paths must be explicitly supplied by the caller.
 */
export async function writeReportWorkbook({ sheets, snapshotId } = {}, outputFile, {
  artifactModule, overwrite = false, previewDir, verificationFile, numericTolerance = 1e-9,
} = {}) {
  const specs = validate(sheets);
  if (typeof outputFile !== 'string' || !outputFile || path.extname(outputFile).toLowerCase() !== '.xlsx') throw new Error('An explicit .xlsx outputFile is required');
  if (!Number.isFinite(numericTolerance) || numericTolerance < 0) throw new Error('Invalid numericTolerance');
  if (artifactModule !== undefined && !(typeof artifactModule === 'string' && (path.isAbsolute(artifactModule) || artifactModule.startsWith('file:')))) throw new Error('artifactModule must be an absolute entry path or file URL');
  const file = path.resolve(outputFile);
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (!overwrite) {
    try { await fs.access(file); throw Object.assign(new Error(`Output already exists: ${file}`), { code: 'EEXIST' }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const staging = await fs.mkdtemp(path.join(path.dirname(file), '.report-workbook-'));
  const stagedFile = path.join(staging, 'report.xlsx');
  try {
    const moduleName = artifactModule && path.isAbsolute(artifactModule) ? pathToFileURL(artifactModule).href : artifactModule;
    const { Workbook, SpreadsheetFile, FileBlob } = await import(moduleName || '@oai/artifact-tool');
    const workbook = Workbook.create();
    for (const spec of specs) workbook.worksheets.add(spec.name);
    for (const spec of specs) {
      const sheet = workbook.worksheets.getItem(spec.name), range = sheet.getRange(spec.range);
      sheet.showGridLines = false;
      range.values = spec.rows.map(row => Array.from({ length: spec.columns }, (_, col) => {
        const cell = row[col] ?? null;
        return isFormula(cell) ? null : typeof cell === 'string' && cell.startsWith('=') ? `'${cell}` : cell;
      }));
      range.format = { font: { name: 'Arial', size: 11, color: '#1F2937' }, wrapText: true, verticalAlignment: 'center', rowHeight: 24 };
      for (let col = 0; col < spec.columns; col++) {
        const column = sheet.getRange(`${columnAddress(col + 1)}1:${columnAddress(col + 1)}${spec.rows.length}`);
        column.format.columnWidth = spec.widths?.[col] ?? 22;
      }
      for (let row = 0; row < spec.rows.length; row++) for (let col = 0; col < spec.rows[row].length; col++) {
        const input = spec.rows[row][col], cell = sheet.getCell(row, col);
        if (isFormula(input)) cell.formulas = [[input.formula]];
        if (typeof input === 'string') { cell.setNumberFormat('@'); cell.format.horizontalAlignment = 'left'; }
        else if (typeof input === 'number' || isFormula(input)) { cell.setNumberFormat(typeof input === 'number' && Number.isInteger(input) ? '#,##0' : '#,##0.00########'); cell.format.horizontalAlignment = 'right'; }
      }
      if (spec.headerRows !== 0) {
        const header = sheet.getRange(`A1:${columnAddress(spec.columns)}1`);
        header.format = { fill: '#203864', font: { name: 'Arial', size: 11, bold: true, color: '#FFFFFF' }, wrapText: true, horizontalAlignment: 'center', rowHeight: 32 };
        sheet.freezePanes.freezeRows(1);
      }
      range.format.autofitRows();
    }
    await workbook.recalculate();
    const before = verifyWorkbook(workbook, specs, numericTolerance, 'recalculated');
    if (!before.passed) verificationFailed({ before });
    if (previewDir) {
      await fs.mkdir(previewDir, { recursive: true });
      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        const preview = await workbook.render({ sheetName: spec.name, range: spec.range, scale: 1, format: 'png' });
        await fs.writeFile(path.join(previewDir, `sheet-${i + 1}.png`), new Uint8Array(await preview.arrayBuffer()), { flag: overwrite ? 'w' : 'wx' });
      }
    }
    const xlsx = await SpreadsheetFile.exportXlsx(workbook);
    await xlsx.save(stagedFile);
    const reopened = await SpreadsheetFile.importXlsx(await FileBlob.load(stagedFile));
    // Check imported values before recalculation so export cache loss is observable.
    const saved = verifyWorkbook(reopened, specs, numericTolerance, 'saved-file');
    await reopened.recalculate();
    const recalculated = verifyWorkbook(reopened, specs, numericTolerance, 'reimport-recalculated');
    if (!saved.passed || !recalculated.passed) verificationFailed({ before, saved, recalculated });
    // A same-directory hard link publishes without replacing a concurrently created file.
    if (overwrite) await fs.rename(stagedFile, file);
    else await fs.link(stagedFile, file);
    const result = { file, snapshotId: snapshotId ?? null, sheets: saved.sheets, verified: before.passed && saved.passed && recalculated.passed, checks: { before, saved, recalculated, engine: 'artifact-tool', blankComparison: 'null and empty string both represent blank cells', nativeExcelChecked: false, visualReview: 'not-automated' } };
    if (verificationFile) await fs.writeFile(verificationFile, JSON.stringify(result, null, 2), { flag: overwrite ? 'w' : 'wx' });
    return result;
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

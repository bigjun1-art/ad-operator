import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { columnAddress, writeReportWorkbook } from './report-workbook.mjs';

function fixture() {
  const rows = [['自定义组名', '长编号原文', '上期值', '本期值', '差额', '条件结果', '原始说明']];
  for (let i = 0; i < 6; i++) {
    const r = i + 2, current = i === 0 ? 0 : i * 12.5;
    rows.push([`合成分组${i + 1}`, `00012345678901234567890${i}`, i * 10, current,
      { formula: `=D${r}-C${r}`, value: current - i * 10 },
      { formula: `=IF(OR(C${r}=0,D${r}=0),0,D${r}/C${r})`, value: i === 0 ? 0 : 1.25 },
      i === 0 ? '=source-value' : i === 1 ? null : `合成资料 ${i + 1}`]);
  }
  rows.push(['合成合计', null, { formula: '=SUM(C2:C7)', value: 150 }, { formula: '=SUM(D2:D7)', value: 187.5 }, { formula: '=D8-C8', value: 37.5 }, null, null]);
  return { snapshotId: 'synthetic-fixture-20261028', sheets: [
    { name: '汇总合成', rows, widths: [18, 35, 15, 15, 15, 15, 26], headerRows: 1 },
    { name: '逐行公式', rows: [['分组', '自定义指标', '预期计算'], ...Array.from({ length: 6 }, (_, i) => [`合成分组${i + 1}`, i, { formula: `=IF(B${i + 2}=0,0,B${i + 2}*2)`, value: i * 2 }])], widths: [20, 20, 20] },
    { name: '原始输入', rows: [['字符串编号', '空白值', '等号源文本'], ['000123456789012345678901', null, '=SUM(A1:A2)'], ["'literal", 0, '=1+1'], ['尾行', '', null], [null, null, null]], widths: [35, 20, 28] },
    { name: '字段字典', rows: [['自定义字段', '说明'], ['长编号原文', '按字符串保留编号与前导零'], ['上期值', '合成数据，用于验证公式'], ['空白值', null]], widths: [24, 40] },
  ] };
}

test('column addresses are generated beyond Z and reject invalid indexes', () => {
  assert.equal(columnAddress(1), 'A'); assert.equal(columnAddress(27), 'AA'); assert.equal(columnAddress(16384), 'XFD');
  for (const n of [0, -1, 1.2, 16385, NaN]) assert.throws(() => columnAddress(n));
});

test('input validation precedes dynamic dependency loading and file creation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-validation-'));
  try {
    const file = path.join(dir, 'never-created.xlsx');
    await assert.rejects(writeReportWorkbook({ sheets: [] }, file), /four sheets/);
    const duplicate = fixture(); duplicate.sheets[3].name = duplicate.sheets[0].name;
    await assert.rejects(writeReportWorkbook(duplicate, file), /Duplicate/);
    const invalid = fixture(); invalid.sheets[1].rows[1][1] = NaN;
    await assert.rejects(writeReportWorkbook(invalid, file), /finite numbers/);
    const missingExpected = fixture(); missingExpected.sheets[1].rows[1][2] = { formula: '=1' };
    await assert.rejects(writeReportWorkbook(missingExpected, file), /finite numbers/);
    await assert.rejects(writeReportWorkbook(fixture()), /explicit/);
    await assert.rejects(writeReportWorkbook(fixture(), file, { artifactModule: './relative.js' }), /absolute/);
    await assert.rejects(fs.stat(file), /ENOENT/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('existing output is not overwritten and module loading failure cleans staging', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-files-'));
  try {
    const file = path.join(dir, 'existing.xlsx');
    await fs.writeFile(file, 'original');
    await assert.rejects(writeReportWorkbook(fixture(), file), { code: 'EEXIST' });
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    const failure = path.join(dir, 'failed.xlsx');
    await assert.rejects(writeReportWorkbook(fixture(), failure, { artifactModule: path.join(dir, 'missing.mjs') }), /Cannot find module/);
    await assert.rejects(fs.stat(failure), /ENOENT/);
    await assert.rejects(writeReportWorkbook(fixture(), file, { artifactModule: path.join(dir, 'missing.mjs'), overwrite: true }), /Cannot find module/);
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    assert.deepEqual(await fs.readdir(dir), ['existing.xlsx']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('all-cell verifier rejects corrupted later rows, formula loss and extra rows', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-mock-'));
  try {
    const modulePath = path.join(dir, 'mock-artifact.mjs');
    await fs.writeFile(modulePath, `
      import fs from 'node:fs/promises';
      let fault;
      export function configure(value) { fault = value; }
      const pos = a => { const m = a.match(/^([A-Z]+)([0-9]+)$/); return [Number(m[2])-1, [...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1]; };
      class Sheet {
        constructor(name, values = [], formulas = []) { this.name = name; this.v = values; this.f = formulas; this.freezePanes = { freezeRows() {} }; }
        getRange(a) {
          const [start,end=start] = a.split(':'); const [r,c] = pos(start), [er,ec] = pos(end); const self = this;
          let style = { autofitRows() {} };
          return {
            get values() { return Array.from({length:er-r+1},(_,i)=>Array.from({length:ec-c+1},(_,j)=>self.v[r+i]?.[c+j]??null)); },
            set values(rows) { rows.forEach((row,i)=>row.forEach((v,j)=>{ (self.v[r+i]??=[])[c+j] = typeof v === 'string' && v.startsWith(\"'=\") ? v.slice(1) : v; })); },
            get formulas() { return Array.from({length:er-r+1},(_,i)=>Array.from({length:ec-c+1},(_,j)=>self.f[r+i]?.[c+j]??null)); },
            set formulas(rows) { rows.forEach((row,i)=>row.forEach((v,j)=>{ (self.f[r+i]??=[])[c+j] = v; (self.v[r+i]??=[])[c+j] = Number(v.slice(1)); })); },
            get format() { return style; }, set format(v) { Object.assign(style,v); }, setNumberFormat() {},
          };
        }
        getCell(r,c) { let x = '', n=c+1; for (;n;n=Math.floor((n-1)/26)) x=String.fromCharCode(65+(n-1)%26)+x; return this.getRange(x+(r+1)); }
        getUsedRange() { return { values: this.v }; }
      }
      class Book {
        constructor() { this.s=[]; this.worksheets={ add: n => { const s=new Sheet(n); this.s.push(s); return s; }, getItem:n=>this.s.find(s=>s.name===n) }; }
        recalculate() {}
      }
      export const Workbook = { create: () => new Book() };
      export const FileBlob = { load: f => fs.readFile(f,'utf8') };
      export const SpreadsheetFile = {
        exportXlsx: async b => ({ save: f => fs.writeFile(f,JSON.stringify(b.s.map(s=>({name:s.name,v:s.v,f:s.f})))) }),
        importXlsx: async text => { const b=new Book(); for (const s of JSON.parse(text)) b.s.push(new Sheet(s.name,s.v,s.f));
          if(fault==='value') b.s[2].v[5][0]='corrupted-later-row';
          if(fault==='formula') b.s[1].f[5][1]=null;
          if(fault==='dimensions') b.s[3].v.push(['extra',null]);
          return b;
        },
      };
    `);
    const mock = await import(pathToFileURL(modulePath).href);
    const sheets = Array.from({ length: 4 }, (_, i) => ({ name: `Mock${i}`, rows: [['ID', '计算'], ...Array.from({ length: 6 }, (_, row) => [`00012345678901234567890${row}`, { formula: '=1', value: 1 }])] }));
    for (const kind of ['value', 'formula', 'dimensions']) {
      mock.configure(kind);
      const output = path.join(dir, `${kind}.xlsx`);
      await assert.rejects(writeReportWorkbook({ sheets }, output, { artifactModule: modulePath }), error => {
        assert.equal(error.code, 'REPORT_WORKBOOK_VERIFICATION_FAILED');
        assert.equal(error.checks.before.passed, true);
        assert.ok(error.checks.saved.mismatches.some(m => m.kind === kind));
        assert.equal(JSON.stringify(error.checks).includes('corrupted-later-row'), false);
        assert.equal(JSON.stringify(error.checks).includes('00012345678901234567890'), false);
        return true;
      });
      await assert.rejects(fs.stat(output), /ENOENT/);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('actual artifact export and all-cell readback of four synthetic sheets', { skip: !process.env.ARTIFACT_MODULE || !process.env.WORKBOOK_VALIDATION_DIR }, async () => {
  const dir = process.env.WORKBOOK_VALIDATION_DIR;
  await fs.mkdir(dir, { recursive: true });
  const report = fixture();
  const result = await writeReportWorkbook(report, path.join(dir, 'synthetic-report.xlsx'), {
    artifactModule: process.env.ARTIFACT_MODULE,
    previewDir: dir,
    verificationFile: path.join(dir, 'readback-validation.json'),
    overwrite: process.env.WORKBOOK_FIXTURE_OVERWRITE === '1',
  });
  assert.equal(result.sheets.length, 4);
  assert.equal(result.sheets[0].rows, 8);
  assert.equal(result.sheets[3].formulaCells, 0);
  assert.equal(result.verified, true, JSON.stringify(result.checks));

  const { SpreadsheetFile, FileBlob } = await import(pathToFileURL(process.env.ARTIFACT_MODULE).href);
  const reopened = await SpreadsheetFile.importXlsx(await FileBlob.load(result.file));
  const sheet = reopened.worksheets.getItem('汇总合成');
  sheet.getRange('D7').values = [[100]];
  await reopened.recalculate();
  const editChecks = {
    changedInput: sheet.getRange('D7').values[0][0],
    lastGroupDifference: sheet.getRange('E7').values[0][0],
    lastGroupRatio: sheet.getRange('F7').values[0][0],
    total: sheet.getRange('D8').values[0][0],
    totalDifference: sheet.getRange('E8').values[0][0],
  };
  assert.deepEqual(editChecks, { changedInput: 100, lastGroupDifference: 50, lastGroupRatio: 2, total: 225, totalDifference: 75 });
  await fs.writeFile(path.join(dir, 'input-change-validation.json'), JSON.stringify({ verified: true, checks: editChecks, persistedFixtureUnchanged: true }, null, 2));
});

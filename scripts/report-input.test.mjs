import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, decodeCsv, validateReportProfile, normalizeReportInput, createReportSnapshot } from './report-input.mjs';

const advertiser = '000900719925474099312345';
function profile(overrides = {}) {
  return { version: 1, platform: 'qianchuan', dataset: 'delivery', level: 'campaign', identity: { advertiserId: advertiser }, period: { start: '2026-10-01', end: '2026-10-07', timezone: 'Asia/Shanghai' }, refundMaturity: 'D7', roiType: 'payment', fieldMap: { campaignId: '计划编号', date: '日期', cost: '消耗（元）', pay_gmv: '支付金额（元）', impressions: '曝光', note: '原始说明' }, ...overrides };
}
const headers = ['计划编号', '日期', '消耗（元）', '支付金额（元）', '曝光', '原始说明'];
const good = (overrides = {}) => ({ headers: [...headers], profile: profile(), source: { type: 'synthetic' }, rows: [['000900719925474099300001', '2026-10-01', '100.25', '300.75', '2000', '=source-value']], ...overrides });

test('CSV preserves BOM, escaped quotes, commas, multiline fields, CRLF and trailing empties', () => {
  const parsed = parseCsv('\uFEFF编号,自定义名,备注\r\n000123,"甲,乙","说""你好""\r\n第二行"\r\n000124,,\r\n');
  assert.deepEqual(parsed, { headers: ['编号', '自定义名', '备注'], rows: [['000123', '甲,乙', '说"你好"\r\n第二行'], ['000124', '', '']] });
});

test('CSV malformed syntax and duplicate or credential headers fail without exposing values', () => {
  for (const csv of ['', 'A,A\n1,2', 'A, a \n1,2', 'A,B\n"unclosed', 'A,B\n"x"oops,y', 'A,B\nx"y,z']) assert.throws(() => parseCsv(csv));
  assert.throws(() => parseCsv('名称,api_key\n合成,synthetic-secret-marker'), error => error.code === 'REPORT_SENSITIVE_FIELD' && !error.message.includes('synthetic-secret-marker'));
});

test('CSV encoding must be explicit and strict for UTF8, GB18030 and GBK', () => {
  assert.equal(decodeCsv(new TextEncoder().encode('\uFEFF中文'), { encoding: 'utf8' }), '中文');
  const gbk = Uint8Array.from([0xD6, 0xD0, 0xCE, 0xC4]);
  assert.equal(decodeCsv(gbk, { encoding: 'GBK' }), '中文');
  assert.equal(decodeCsv(gbk, { encoding: 'gb18030' }), '中文');
  assert.throws(() => decodeCsv(gbk));
  assert.throws(() => decodeCsv(gbk, { encoding: 'utf8' }), /不符合指定编码/);
  assert.throws(() => decodeCsv(gbk, { encoding: 'latin1' }), /不支持/);
});

test('profile validates dates, timezone, maturity, ROI type and identity roles', () => {
  for (const period of [{ start: '2026-02-30', end: '2026-03-01', timezone: 'Asia/Shanghai' }, { start: '2026-10-02', end: '2026-10-01', timezone: 'UTC' }, { date: '2026-10-01', timezone: 'not-a-timezone' }]) assert.throws(() => validateReportProfile(profile({ period })));
  for (const overrides of [{ version: 2 }, { refundMaturity: 'D8' }, { roiType: 'source-label' }, { identity: { accountId: advertiser } }, { identity: { advertiserId: 123 } }, { identity: { advertiserId: '9.007e20' } }, { fieldMap: { cost: '费用', pay_gmv: '费用' } }]) assert.throws(() => validateReportProfile(profile(overrides)));
  const result = validateReportProfile(profile({ period: { date: '2024-02-29', timezone: 'UTC' }, sourceRoiLabel: '平台原始展示标签' }));
  assert.equal(result.period.start, '2024-02-29'); assert.equal(result.period.end, '2024-02-29'); assert.equal(result.sourceRoiLabel, '平台原始展示标签');
});

test('long IDs, original strings, null metrics and unknown custom fields are preserved', () => {
  const input = good(); input.rows[0][3] = ''; input.rows[0][4] = null;
  const result = normalizeReportInput(input), row = result.accepted[0];
  assert.equal(result.complete, true); assert.equal(result.rejected.length, 0);
  assert.equal(row.values.campaignId, '000900719925474099300001'); assert.equal(row.identity.advertiserId, advertiser);
  assert.equal(row.values.cost, 100.25); assert.equal(row.values.pay_gmv, null); assert.equal(row.values.impressions, null);
  assert.equal(row.values.note, '=source-value'); assert.equal(row.raw[3], ''); assert.equal(row.rowNumber, 2);
  assert.equal(row.refundMaturity, 'D7'); assert.match(row.objectKey, /^[a-f0-9]{64}$/);
});

test('invalid rows are rejected with location and unaffected rows still import', () => {
  const input = good();
  input.rows.push(['9007199254740993', '2026-10-02', '-1', '5', '100', '负金额'], ['9.007199254740993e15', '2026-10-02', '5', '5', '100', '科学计数ID'], ['new-id', '2026-10-02', 'Infinity', '5', '100', '无效数值'], ['short-row']);
  const result = normalizeReportInput(input);
  assert.equal(result.complete, false); assert.equal(result.accepted.length, 1); assert.equal(result.rejected.length, 4);
  assert.deepEqual(result.rejected.map(row => row.rowNumber), [3, 4, 5, 6]);
  assert.equal(result.rejected[0].reasons[0].field, 'cost'); assert.equal(result.rejected[1].reasons[0].code, 'REPORT_ID');
});

test('money units normalize exactly once and conflicting or absent units fail', () => {
  const p = profile({ fieldMap: { campaignId: 'ID', cost: '消耗（分）', pay_gmv: 'GMV（千分之一分）' } });
  const result = normalizeReportInput({ profile: p, headers: ['ID', '消耗（分）', 'GMV（千分之一分）'], rows: [['id-1', '12345', '12000000']] });
  assert.equal(result.accepted[0].values.cost, 123.45); assert.equal(result.accepted[0].values.pay_gmv, 120);
  const mapped = profile({ moneyUnit: 'yuan', unitByField: { cost: 'fen' }, fieldMap: { campaignId: 'ID', cost: '消费', pay_gmv: '支付' } });
  const alternate = normalizeReportInput({ profile: mapped, headers: ['ID', '消费', '支付'], rows: [['id-1', '100', '10']] });
  assert.equal(alternate.accepted[0].values.cost, 1); assert.equal(alternate.accepted[0].values.pay_gmv, 10);
  assert.throws(() => normalizeReportInput({ profile: { ...p, moneyUnit: 'yuan' }, headers: ['ID', '消耗（分）', 'GMV（千分之一分）'], rows: [] }), /冲突/);
  assert.throws(() => normalizeReportInput({ profile: profile({ fieldMap: { campaignId: 'ID', cost: '费用' } }), headers: ['ID', '费用'], rows: [] }), /缺少明确金额单位/);
});

test('source identity roles never substitute for each other and explicit conflicts reject', () => {
  const input = good({ profile: profile({ identity: {}, fieldMap: { advertiserId: '广告账户', douyinId: '抖音号', campaignId: 'ID', cost: '消耗（元）' } }), headers: ['广告账户', '抖音号', 'ID', '消耗（元）'], rows: [[advertiser, 'douyin-1', 'campaign-1', '1']] });
  const row = normalizeReportInput(input).accepted[0];
  assert.equal(row.identity.advertiserId, advertiser); assert.equal(row.identity.douyinId, 'douyin-1');
  input.profile.identity = { advertiserId: 'another-advertiser' };
  assert.equal(normalizeReportInput(input).rejected[0].reasons[0].code, 'REPORT_IDENTITY');
  input.profile.identity = {}; input.rows[0][0] = '';
  assert.equal(normalizeReportInput(input).accepted.length, 0);
});

test('different dates count as one object but remain different observations; duplicates reject', () => {
  const input = good(); input.rows.push([...input.rows[0]]); input.rows[1][1] = '2026-10-02'; input.rows.push([...input.rows[0]]);
  const result = normalizeReportInput(input);
  assert.equal(result.accepted.length, 2); assert.equal(result.coverage.distinctObjects, 1);
  assert.equal(result.accepted[0].objectKey, result.accepted[1].objectKey);
  assert.notEqual(result.accepted[0].observationKey, result.accepted[1].observationKey);
  assert.equal(result.rejected[0].reasons[0].code, 'REPORT_DUPLICATE');
});

test('row date and metadata must match the declared period and refund maturity', () => {
  const input = good(); input.rows[0][1] = '2026-10-08';
  assert.equal(normalizeReportInput(input).rejected[0].reasons[0].code, 'REPORT_PERIOD');
  const mismatch = good({ source: { refundMaturity: 'D0' } });
  assert.throws(() => normalizeReportInput(mismatch), /refundMaturity/);
  input.profile.fieldMap.refundMaturity = '退款成熟度'; input.headers.push('退款成熟度'); input.rows[0][1] = '2026-10-01'; input.rows[0].push('D0');
  assert.equal(normalizeReportInput(input).rejected[0].reasons[0].code, 'REPORT_SCOPE');
});

test('livestream timestamps use profile timezone and do not reinterpret account roles', () => {
  const p = profile({ dataset: 'livestream', level: 'session', identity: { douyinId: 'douyin-1' }, period: { date: '2026-10-03', timezone: 'Asia/Shanghai' }, fieldMap: { sessionId: '场次ID', startTime: '开始', endTime: '结束', viewers: '观看人数', duration_seconds: '时长' } });
  const input = { profile: p, headers: ['场次ID', '开始', '结束', '观看人数', '时长'], rows: [['room-1', '2026-10-02T17:00:00Z', '2026-10-03 02:00:00', '100', '3600']] };
  const row = normalizeReportInput(input).accepted[0];
  assert.equal(row.values.startTime, '2026-10-02T17:00:00Z'); assert.equal(row.identity.advertiserId, undefined);
  input.rows[0][2] = '2026-10-03 00:00:00';
  assert.equal(normalizeReportInput(input).rejected[0].reasons[0].code, 'REPORT_DATE');
});

test('snapshot digest is deterministic across createdAt and changes with source content', () => {
  const a = createReportSnapshot(good()), b = createReportSnapshot(good());
  assert.match(a.id, /^[a-f0-9]{64}$/); assert.equal(a.id, b.id); assert.equal(a.rows.length, 1);
  const changed = good(); changed.rows[0][2] = '101';
  assert.notEqual(createReportSnapshot(changed).id, a.id);
  assert.notEqual(createReportSnapshot(good({ source: { type: 'different-synthetic-source' } })).id, a.id);
});

test('object input rows, absent role identity and sensitive metadata have bounded errors', () => {
  const input = good(); input.rows = [Object.fromEntries(headers.map((name, i) => [name, input.rows[0][i]]))]; delete input.headers;
  assert.equal(normalizeReportInput(input).accepted.length, 1);
  const hidden = good({ source: { authorization: 'synthetic-marker' } });
  assert.throws(() => createReportSnapshot(hidden), error => error.code === 'REPORT_SENSITIVE_FIELD' && !error.message.includes('synthetic-marker'));
  const unmapped = good(); unmapped.headers.push('Cookie'); unmapped.rows[0].push('synthetic-marker');
  assert.throws(() => createReportSnapshot(unmapped), error => error.code === 'REPORT_SENSITIVE_FIELD' && !error.message.includes('synthetic-marker'));
});

test('platform, count safety, required object IDs and object columns are explicit', () => {
  assert.throws(() => validateReportProfile(profile({ platform: 'other' })), /platform/);
  for (const value of ['1.5', '9007199254740993', NaN, Infinity, -1]) {
    const input = good(); input.rows[0][4] = value;
    assert.equal(normalizeReportInput(input).accepted.length, 0);
  }
  const missing = good(); missing.rows[0][0] = '';
  assert.equal(normalizeReportInput(missing).rejected[0].reasons.some(reason => reason.reason === 'missing_campaign_id'), true);
  const raw = good(); raw.rows = [Object.fromEntries(raw.headers.map((h, i) => [h, raw.rows[0][i]]))]; delete raw.rows[0]['原始说明'];
  assert.equal(normalizeReportInput(raw).rejected[0].reasons[0].code, 'REPORT_ROW_SHAPE');
  const empty = normalizeReportInput(good({ rows: [] }));
  assert.equal(empty.complete, false); assert.equal(empty.coverage.issues[0].code, 'no_data_rows');
});

test('session ID is required and cross-period endings are rejected with period reason', () => {
  const p = profile({ dataset: 'livestream', level: 'session', identity: { douyinId: 'douyin-1' }, period: { date: '2026-10-03', timezone: 'Asia/Shanghai' }, fieldMap: { sessionId: '场次ID', startTime: '开始', endTime: '结束', watch_seconds: '观看秒数' } });
  const input = { profile: p, headers: ['场次ID', '开始', '结束', '观看秒数'], rows: [['', '2026-10-03 23:00:00.123', '2026-10-03 23:30:00.123', '123.5']] };
  assert.equal(normalizeReportInput(input).rejected[0].reasons[0].reason, 'missing_session_id');
  input.rows[0][0] = 'room-1';
  assert.equal(normalizeReportInput(input).accepted[0].values.watch_seconds, 123.5);
  input.rows[0][2] = '2026-10-04 00:30:00';
  assert.equal(normalizeReportInput(input).rejected[0].reasons[0].code, 'REPORT_PERIOD');
});

test('source metadata cannot relabel periods or identities', () => {
  assert.throws(() => normalizeReportInput(good({ source: { period: { date: '2026-10-01', timezone: 'Asia/Shanghai' } } })), /source.period/);
  assert.throws(() => normalizeReportInput(good({ source: { identity: { advertiserId: 'another' } } })), /同角色身份/);
});

test('daily grain cannot mix period totals, offset timestamps or duplicate observations',()=>{
 const input=good();input.rows.push([...input.rows[0]]);input.rows[1][1]='';let r=normalizeReportInput(input);assert.equal(r.accepted.length,1);assert.equal(r.complete,false);assert.equal(r.rejected[0].reasons[0].code,'REPORT_DATE');
 input.rows[1][1]='2026-10-01T00:00:00+08:00';r=normalizeReportInput(input);assert.equal(r.accepted.length,1);assert.equal(r.rejected[0].reasons[0].code,'REPORT_DATE');
 const p=profile({dataset:'livestream',level:'session',identity:{douyinId:'dy-1'},fieldMap:{sessionId:'ID',startTime:'开始'},period:{date:'2026-10-01',timezone:'Asia/Shanghai'}});r=normalizeReportInput({profile:p,headers:['ID','开始'],rows:[['session-1','2026-10-01T00:00:00+08:00'],['session-1','2026-09-30T16:00:00Z']]});assert.equal(r.accepted.length,1);assert.equal(r.rejected[0].reasons[0].code,'REPORT_DUPLICATE');
});
test('single snapshot cannot silently sum different source accounts or unsafe monetary values',()=>{
 const input=good({profile:profile({identity:{},fieldMap:{advertiserId:'账户',campaignId:'ID',cost:'消耗（元）'}}),headers:['账户','ID','消耗（元）'],rows:[['account-a','campaign-a','1'],['account-b','campaign-b','2']]});assert.throws(()=>normalizeReportInput(input),/不同账户/);
 const large=good();large.rows[0][2]='9007199254740993';const r=normalizeReportInput(large);assert.equal(r.accepted.length,0);assert.equal(r.rejected[0].reasons[0].code,'REPORT_NUMBER');
});

import { createHash } from 'node:crypto';

const ROLES = ['advertiserId', 'douyinId', 'anchorId', 'anchorShowId'];
const IDS = new Set([...ROLES, 'campaignId', 'materialId', 'sessionId']);
const MONEY = new Set(['cost', 'pay_gmv', 'net_gmv', 'marketing_cost', 'estimated_commission', 'estimated_leader_service_fee', 'budget']);
const NUMERIC = new Set([...MONEY, 'impressions', 'clicks', 'conversions', 'orders', 'viewers', 'views', 'natural_viewers', 'watch_seconds', 'duration_seconds', 'reported_payment_roi', 'reported_net_roi', 'reported_marketing_roi']);
const COUNTS = new Set(['impressions', 'clicks', 'conversions', 'orders', 'viewers', 'views', 'natural_viewers']);
const DATES = new Set(['date', 'startTime', 'endTime']);
const MATURITY = new Set(['D0', 'D1', 'D7', 'D14', 'settled', 'unknown']);
const ROI_TYPES = new Set(['payment', 'net', 'marketing', 'unknown']);
const CREDENTIAL = /(?:password|passwd|secret|token|cookie|authorization|credential|api[ _-]?key|access[ _-]?key|密码|密钥|令牌|凭据)/i;
const UNIT_DIVISORS = { yuan: 1, fen: 100, thousandth_fen: 100000 };
const UNIT_NAMES = { yuan: 'yuan', '元': 'yuan', fen: 'fen', '分': 'fen', thousandth_fen: 'thousandth_fen', '千分之一分': 'thousandth_fen' };
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function text(value, label) { if (typeof value !== 'string' || !value.trim()) fail('REPORT_PROFILE', `${label} 必须为非空字符串`); return value.trim(); }
function checkKeys(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) fail('REPORT_INPUT', '输入不能包含循环引用');
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (CREDENTIAL.test(key)) fail('REPORT_SENSITIVE_FIELD', '检测到疑似凭据字段，已拒绝输入');
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('REPORT_INPUT', '输入包含不支持的字段名');
    checkKeys(value[key], seen);
  }
  seen.delete(value);
}
function copy(value) { return value === undefined ? null : JSON.parse(JSON.stringify(value)); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(v => stable(v === undefined ? null : v)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) { return createHash('sha256').update(stable(value)).digest('hex'); }
function id(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail('REPORT_ID', `${label} 必须为非空字符串编号`);
  const result = value.trim();
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(result)) fail('REPORT_ID', `${label} 不接受科学计数编号`);
  if (result.length>256 || !/^[A-Za-z0-9_.:-]+$/.test(result) || /^\d+\.\d+$/.test(result)) fail('REPORT_ID', `${label} 编号格式无效`);
  return result;
}

function dateParts(value, label) {
  const s = text(value, label);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?)?$/.exec(s);
  if (!m) fail('REPORT_DATE', `${label} 日期格式无效`);
  const [, y, mo, d, hh = '00', mm = '00', ss = '00', ms = '0', zone] = m;
  const date = new Date(0);
  date.setUTCFullYear(+y, +mo - 1, +d); date.setUTCHours(+hh, +mm, +ss, +ms.padEnd(3, '0'));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d || +hh > 23 || +mm > 59 || +ss > 59) fail('REPORT_DATE', `${label} 不是有效日历日期`);
  if (zone && zone !== 'Z' && (+zone.slice(1, 3) > 23 || +zone.slice(4, 6) > 59)) fail('REPORT_DATE', `${label} 时区偏移无效`);
  return { text: s, day: s.slice(0, 10), hasTime: Boolean(m[4]), epoch: date.getTime(), zone };
}

function zonedParts(epoch, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
  const p = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
function epoch(parts, timezone) {
  if (parts.zone) {
    if (parts.zone === 'Z') return parts.epoch;
    const offset = (+parts.zone.slice(1, 3) * 60 + +parts.zone.slice(4, 6)) * 60000;
    return parts.epoch - (parts.zone[0] === '+' ? offset : -offset);
  }
  if(parts.hasTime&&!['Asia/Shanghai','UTC','Etc/UTC'].includes(timezone))fail('REPORT_DATE','该时区的场次时间需要显式UTC偏移');
  let guess = parts.epoch;
  for (let i = 0; i < 4; i++) {
    const at = dateParts(zonedParts(guess, timezone), '本地时间');
    const delta = parts.epoch - (at.epoch + ((guess % 1000 + 1000) % 1000));
    if (delta === 0) return guess;
    guess += delta;
  }
  fail('REPORT_DATE', '本地时间在指定时区中不存在或不能唯一解析');
}
function normalizedPeriod(input, fallbackTimezone) {
  if (!plainObject(input)) fail('REPORT_PROFILE', 'period 必须为对象');
  const timezone = text(input.timezone ?? fallbackTimezone, 'period.timezone');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date(0)); } catch { fail('REPORT_PROFILE', 'period.timezone 不是有效时区'); }
  const start = dateParts(input.start ?? input.date, 'period.start');
  const end = dateParts(input.end ?? input.date, 'period.end');
  if (input.date) {
    const day = dateParts(input.date, 'period.date');
    if (day.hasTime || day.day !== start.day || day.day !== end.day) fail('REPORT_PROFILE', 'period.date 与起止日期不一致');
  }
  if (epoch(end, timezone) < epoch(start, timezone)) fail('REPORT_PROFILE', 'period.end 不能早于 period.start');
  return { ...copy(input), start: start.text, end: end.text, timezone };
}
function unit(value, label) {
  if (!Object.hasOwn(UNIT_NAMES, value)) fail('REPORT_UNIT', `${label} 单位必须为 yuan、fen 或 thousandth_fen`);
  return UNIT_NAMES[value];
}
function headerUnit(header) {
  if (/(?:万元|千元|亿元)/.test(header)) fail('REPORT_UNIT', '表头包含尚不支持的金额单位');
  if (/千分之一分/.test(header)) return 'thousandth_fen';
  if (/(?:[（(\[【]\s*元\s*[）)\]】]|元\s*$)/.test(header)) return 'yuan';
  if (/(?:[（(\[【]\s*分\s*[）)\]】]|分\s*$)/.test(header)) return 'fen';
  return null;
}

export function validateReportProfile(input) {
  checkKeys(input);
  if (!plainObject(input) || input.version !== 1) fail('REPORT_PROFILE', 'profile.version 必须为 1');
  const profile = copy(input);
  profile.platform = text(profile.platform, 'platform');
  if (!['qianchuan', 'suixin', 'local'].includes(profile.platform)) fail('REPORT_PROFILE', 'platform 必须为 qianchuan、suixin 或 local');
  if (!['delivery', 'livestream'].includes(profile.dataset)) fail('REPORT_PROFILE', 'dataset 必须为 delivery 或 livestream');
  if (!['account', 'campaign', 'material', 'session'].includes(profile.level)) fail('REPORT_PROFILE', 'level 无效');
  if (!MATURITY.has(profile.refundMaturity)) fail('REPORT_PROFILE', 'refundMaturity 必须为 D0、D1、D7、D14、settled 或 unknown');
  if (!ROI_TYPES.has(profile.roiType)) fail('REPORT_PROFILE', 'roiType 必须为 payment、net、marketing 或 unknown');
  profile.period = normalizedPeriod(profile.period, profile.timezone);
  if(profile.scene!==undefined)profile.scene=text(profile.scene,'scene');
  profile.identity ??= {};
  if (!plainObject(profile.identity)) fail('REPORT_PROFILE', 'identity 必须为角色到编号的对象');
  for (const [role, value] of Object.entries(profile.identity)) {
    if (!ROLES.includes(role)) fail('REPORT_PROFILE', 'identity 包含未知身份角色');
    profile.identity[role] = id(value, `identity.${role}`);
  }
  if (!plainObject(profile.fieldMap) || !Object.keys(profile.fieldMap).length) fail('REPORT_PROFILE', 'fieldMap 必须为非空字段映射');
  const rawHeaders = new Set();
  for (const [canonical, raw] of Object.entries(profile.fieldMap)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(canonical)) fail('REPORT_PROFILE', 'fieldMap 规范字段名无效');
    if (typeof raw !== 'string' || !raw.trim()) fail('REPORT_PROFILE', 'fieldMap 源表头必须为非空字符串');
    if (rawHeaders.has(raw)) fail('REPORT_PROFILE', '同一源表头不能映射到不同规范字段');
    rawHeaders.add(raw);
  }
  if (profile.moneyUnit !== undefined) profile.moneyUnit = unit(profile.moneyUnit, 'moneyUnit');
  if (profile.unitByField !== undefined && !plainObject(profile.unitByField)) fail('REPORT_PROFILE', 'unitByField 必须为对象');
  profile.unitByField ??= {};
  for (const [field, value] of Object.entries(profile.unitByField)) {
    if (!MONEY.has(field) || !Object.hasOwn(profile.fieldMap, field)) fail('REPORT_UNIT', 'unitByField 只能指定已映射的金额字段');
    profile.unitByField[field] = unit(value, `unitByField.${field}`);
  }
  for (const [field, header] of Object.entries(profile.fieldMap)) if (MONEY.has(field)) {
    const fromHeader = headerUnit(header), configured = profile.unitByField[field] ?? profile.moneyUnit ?? null;
    if (fromHeader && configured && fromHeader !== configured) fail('REPORT_UNIT', `${field} 表头金额单位与配置冲突`);
    if (!fromHeader && !configured) fail('REPORT_UNIT', `${field} 缺少明确金额单位`);
  }
  return profile;
}

export function decodeCsv(bytes, { encoding } = {}) {
  if (typeof encoding !== 'string') fail('REPORT_ENCODING', '必须显式指定 CSV 编码 utf8 或 gb18030/gbk');
  const name = encoding.toLowerCase();
  const label = ['utf8', 'utf-8'].includes(name) ? 'utf-8' : ['gb18030', 'gbk'].includes(name) ? 'gb18030' : null;
  if (!label) fail('REPORT_ENCODING', '不支持该 CSV 编码');
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) fail('REPORT_ENCODING', 'CSV 输入必须为字节数组');
  try { return new TextDecoder(label, { fatal: true }).decode(bytes); } catch { fail('REPORT_ENCODING', 'CSV 字节不符合指定编码'); }
}

export function parseCsv(input) {
  if (typeof input !== 'string') fail('REPORT_CSV', 'CSV 输入必须为字符串');
  const source = input.replace(/^\uFEFF/, '');
  if (!source.length) fail('REPORT_CSV', 'CSV 输入为空');
  const records = [];
  let record = [], field = '', quoted = false, closed = false, started = false;
  const pushField = () => { record.push(field); field = ''; closed = false; started = false; };
  const pushRow = () => { pushField(); records.push(record); record = []; };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
      continue;
    }
    if (closed && char !== ',' && char !== '\r' && char !== '\n') fail('REPORT_CSV', 'CSV 引号结束后出现无效字符');
    if (char === '"') {
      if (started) fail('REPORT_CSV', 'CSV 未加引号字段中出现双引号');
      quoted = true; started = true;
    } else if (char === ',') pushField();
    else if (char === '\r' || char === '\n') { pushRow(); if (char === '\r' && source[i + 1] === '\n') i++; }
    else { field += char; started = true; }
  }
  if (quoted) fail('REPORT_CSV', 'CSV 双引号未闭合');
  if (record.length || field.length || started || closed) pushRow();
  const headers = records.shift() ?? [];
  validateHeaders(headers);
  return { headers, rows: records };
}

function validateHeaders(headers) {
  if (!Array.isArray(headers) || !headers.length || headers.some(h => typeof h !== 'string' || !h.trim())) fail('REPORT_HEADERS', '表头必须为非空字符串数组');
  if (headers.some(h => CREDENTIAL.test(h))) fail('REPORT_SENSITIVE_FIELD', '检测到疑似凭据表头，已拒绝导入');
  if (new Set(headers.map(h => h.trim().toLowerCase())).size !== headers.length) fail('REPORT_HEADERS', '表头不能重复');
  if (headers.some(h => ['__proto__', 'prototype', 'constructor'].includes(h))) fail('REPORT_HEADERS', '表头包含不支持的字段名');
}
function number(value, field) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value === 'number') { if (Number.isFinite(value) && value >= 0) return value; fail('REPORT_NUMBER', `${field} 必须为非负有限数值`); }
  if (typeof value !== 'string' || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value.trim())) fail('REPORT_NUMBER', `${field} 数值格式无效`);
  const parsed = Number(value.trim().replaceAll(',', ''));
  if (!Number.isFinite(parsed) || parsed < 0) fail('REPORT_NUMBER', `${field} 必须为非负有限数值`);
  return parsed;
}
function inPeriod(value, field, period) {
  const parts = dateParts(value, field), start = dateParts(period.start, 'period.start'), end = dateParts(period.end, 'period.end');
  const rowEpoch = epoch(parts, period.timezone), min = epoch(start, period.timezone);
  const nextDay = new Date(end.epoch + 86400000).toISOString().slice(0, 10);
  const max = end.hasTime ? epoch(end, period.timezone) : epoch(dateParts(nextDay, '下一日'), period.timezone) - 1;
  if (rowEpoch < min || rowEpoch > max) fail('REPORT_PERIOD', `${field} 超出 profile.period`);
  return parts.text;
}

export function normalizeReportInput({ rows, headers, profile: input, source = null } = {}) {
  const profile = validateReportProfile(input);
  checkKeys(source);
  if (!Array.isArray(rows)) fail('REPORT_ROWS', 'rows 必须为数组');
  const sourceCopy = copy(source);
  if (plainObject(sourceCopy)) {
    for (const field of ['platform', 'dataset', 'level', 'refundMaturity', 'roiType', 'scene', 'dataPeriod']) if (sourceCopy[field] !== undefined && sourceCopy[field] !== profile[field]) fail('REPORT_SOURCE', `source.${field} 与 profile 不一致`);
    if (sourceCopy.period !== undefined) {
      const period = normalizedPeriod(sourceCopy.period, profile.period.timezone);
      if (period.start !== profile.period.start || period.end !== profile.period.end || period.timezone !== profile.period.timezone) fail('REPORT_SOURCE', 'source.period 与 profile 不一致');
    }
    if (sourceCopy.identity !== undefined) {
      if (!plainObject(sourceCopy.identity)) fail('REPORT_SOURCE', 'source.identity 必须为角色到编号的对象');
      for (const [role, value] of Object.entries(sourceCopy.identity)) {
        if (!ROLES.includes(role)) fail('REPORT_SOURCE', 'source.identity 包含未知身份角色');
        const identity = id(value, `source.identity.${role}`);
        if (profile.identity[role] !== undefined && profile.identity[role] !== identity) fail('REPORT_SOURCE', `source.identity.${role} 与 profile 同角色身份不一致`);
      }
    }
  }
  const columns = headers ?? (plainObject(rows[0]) ? Object.keys(rows[0]) : null);
  validateHeaders(columns);
  const index = new Map(columns.map((header, i) => [header, i]));
  const units = {};
  for (const [field, header] of Object.entries(profile.fieldMap)) {
    if (!index.has(header)) fail('REPORT_HEADERS', `缺少映射表头：${header}`);
    if (MONEY.has(field)) {
      const fromHeader = headerUnit(header), configured = profile.unitByField[field] ?? profile.moneyUnit ?? null;
      if (fromHeader && configured && fromHeader !== configured) fail('REPORT_UNIT', `${field} 表头金额单位与配置冲突`);
      units[field] = configured ?? fromHeader;
      if (!units[field]) fail('REPORT_UNIT', `${field} 缺少明确金额单位`);
    }
  }
  const accepted = [], rejected = [], seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i], rowNumber = i + 2, reasons = [], values = {}, identity = { ...profile.identity };
    checkKeys(raw);
    if ((!Array.isArray(raw) && !plainObject(raw)) || (Array.isArray(raw) && raw.length !== columns.length) || (plainObject(raw) && columns.some(header => !Object.hasOwn(raw, header)))) {
      rejected.push({ rowNumber, raw: copy(raw), reasons: [{ code: 'REPORT_ROW_SHAPE', message: '数据行类型或列数与表头不一致' }] }); continue;
    }
    for (const [field, header] of Object.entries(profile.fieldMap)) {
      const value = Array.isArray(raw) ? raw[index.get(header)] : raw[header];
      const blank = value === null || value === undefined || (typeof value === 'string' && !value.trim());
      try {
        if (blank&&field==='date')fail('REPORT_DATE','已映射date的逐日数据不能为空');
        if (blank) values[field] = null;
        else if (IDS.has(field)) values[field] = id(value, field);
        else if (NUMERIC.has(field)) {
          values[field] = number(value, field);
          if (COUNTS.has(field) && values[field] !== null && !Number.isSafeInteger(values[field])) fail('REPORT_NUMBER', `${field} 必须为非负安全整数`);
        }
        else if (DATES.has(field)){if(field==='date'&&dateParts(value,field).hasTime)fail('REPORT_DATE','date需要YYYY-MM-DD日粒度；场次时间请映射startTime/endTime');values[field]=inPeriod(value, field, profile.period);}
        else if (['string', 'number', 'boolean'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value))) values[field] = String(value);
        else fail('REPORT_VALUE', `${field} 必须为单个字符串或数值`);
        if (MONEY.has(field) && values[field] !== null) {
          values[field] /= UNIT_DIVISORS[units[field]];
          if (Math.abs(values[field])*100000>Number.MAX_SAFE_INTEGER) fail('REPORT_NUMBER', `${field} 金额超出可精确换算范围`);
          if (!Number.isFinite(values[field])) fail('REPORT_NUMBER', `${field} 金额换算后不是有限数值`);
        }
        if (ROLES.includes(field) && values[field] !== null) {
          if (identity[field] !== undefined && identity[field] !== values[field]) fail('REPORT_IDENTITY', `${field} 与 profile 同角色身份不一致`);
          if (sourceCopy?.identity?.[field] !== undefined && sourceCopy.identity[field] !== values[field]) fail('REPORT_IDENTITY', `${field} 与 source 同角色身份不一致`);
          identity[field] = values[field];
        }
      } catch (error) { reasons.push({ field, code: error.code ?? 'REPORT_VALUE', message: error.message }); }
    }
    if (profile.dataset === 'delivery' && !identity.advertiserId) reasons.push({ code: 'REPORT_IDENTITY', message: 'delivery 缺少 advertiserId 角色身份' });
    if (profile.dataset === 'livestream' && !ROLES.some(role => identity[role])) reasons.push({ code: 'REPORT_IDENTITY', message: 'livestream 缺少明确角色身份' });
    const objectField = { campaign: 'campaignId', material: 'materialId', session: 'sessionId' }[profile.level];
    if (objectField && !values[objectField]) reasons.push({ field: objectField, code: profile.level === 'session' ? 'missing_session_id' : 'REPORT_OBJECT', reason: `missing_${profile.level}_id`, message: `${profile.level} 缺少对象编号` });
    for (const field of ['refundMaturity', 'roiType']) if (values[field] !== undefined && values[field] !== null && values[field] !== profile[field]) reasons.push({ field, code: 'REPORT_SCOPE', message: `${field} 与 profile 不一致` });
    if (values.startTime && values.endTime && epoch(dateParts(values.endTime, 'endTime'), profile.period.timezone) < epoch(dateParts(values.startTime, 'startTime'), profile.period.timezone)) reasons.push({ code: 'REPORT_DATE', message: 'endTime 不能早于 startTime' });
    const objectKey = hash({ platform: profile.platform, level: profile.level, identity, objectId: objectField ? values[objectField] ?? null : null });
    const observationKey = hash({ objectKey, date: values.date ?? null, startTime: values.startTime?epoch(dateParts(values.startTime,'startTime'),profile.period.timezone):null, endTime: values.endTime?epoch(dateParts(values.endTime,'endTime'),profile.period.timezone):null, period: profile.period, source: sourceCopy });
    if (!reasons.length && seen.has(observationKey)) reasons.push({ code: 'REPORT_DUPLICATE', message: '同一对象、周期和来源的观测行重复' });
    if (reasons.length) { rejected.push({ rowNumber, raw: copy(raw), reasons }); continue; }
    seen.add(observationKey);
    accepted.push({ raw: copy(raw), rowNumber, values, identity, period: copy(profile.period), refundMaturity: profile.refundMaturity, objectKey, observationKey });
  }
  const primary=row=>row.identity.advertiserId?{advertiserId:row.identity.advertiserId}:row.identity.douyinId?{douyinId:row.identity.douyinId}:row.identity.anchorId?{anchorId:row.identity.anchorId}:{anchorShowId:row.identity.anchorShowId};
  if(new Set(accepted.map(row=>stable(primary(row)))).size>1)fail('REPORT_IDENTITY','同一快照包含不同账户，请按账户分别导入');
  if(accepted.length)Object.assign(profile.identity,primary(accepted[0]));
  return { profile, source: sourceCopy, headers: [...columns], accepted, rejected, complete: rows.length > 0 && rejected.length === 0, coverage: { inputRows: rows.length, acceptedRows: accepted.length, rejectedRows: rejected.length, distinctObjects: new Set(accepted.map(row => row.objectKey)).size, moneyUnits: units, normalizedMoneyUnit: 'yuan', roles: ROLES.filter(role => accepted.some(row => row.identity[role])), issues: rows.length ? [] : [{ code: 'no_data_rows', message: '输入没有数据行' }] } };
}

export function createReportSnapshot(input) {
  const normalized = normalizeReportInput(input);
  const content = { version: 1, profile: normalized.profile, source: normalized.source, headers: normalized.headers, rows: normalized.accepted, rejected: normalized.rejected, complete: normalized.complete, coverage: normalized.coverage };
  return { ...content, id: hash(content), createdAt: new Date().toISOString() };
}

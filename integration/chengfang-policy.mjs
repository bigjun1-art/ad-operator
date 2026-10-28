/** Pure read-only rules from the supplied 2026 Chengfang document snapshots. */
export const CHENGFANG_FEE_EXCLUSION_DATE = '2026-08-01';
const amount = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const id = v => typeof v === 'string' && v.trim() ? v : null;
const platformId=v=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v)?v:null;
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v ? v : null;
const time = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : typeof v === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;

/** Monetary fields require explicit units[field] === 'yuan'; ROI requires 'ratio'.
 * effectiveDate is the report date, not retrieval time. combined never emits ROI.
 * includeLeaderServiceFee must be explicit for commission-inclusive reports;
 * base delivery defaults to excluding leader fees. It is distinct from ecommerce
 * technical fees. source and units are retained; missing values remain null.
 */
export function buildChengfangMetrics(input = {}) {
  const period = ['chengfang', 'uni', 'combined'].includes(input.period) ? input.period : null;
  const units = { ...input.units }, effectiveDate = date(input.effectiveDate);
  const commissionIncluded = typeof input.commissionIncluded === 'boolean' ? input.commissionIncluded : null;
  const includeLeaderServiceFee = typeof input.includeLeaderServiceFee === 'boolean' ? input.includeLeaderServiceFee : period === 'uni' || commissionIncluded === false ? false : null;
  const money = field => units[field] === 'yuan' ? amount(input[field]) : null;
  const costYuan = money('costYuan'), netGmvYuan = money('netGmvYuan'), estimatedCommissionYuan = money('estimatedCommissionYuan'), estimatedLeaderServiceFeeYuan = money('estimatedLeaderServiceFeeYuan');
  const officialMarketingRoi = units.officialMarketingRoi === 'ratio' ? amount(input.officialMarketingRoi) : null;
  const issues = [];
  if (!period) issues.push('period_unknown');
  if (period === 'combined') issues.push('combined_roi_not_aggregated');
  if (costYuan === null) issues.push('cost_or_unit_unknown');
  if (netGmvYuan === null) issues.push('net_gmv_or_unit_unknown');
  if (period === 'chengfang' && commissionIncluded === null) issues.push('commission_switch_unknown');
  if (period === 'uni' && commissionIncluded === true) issues.push('uni_commission_basis_conflict');
  const ruleApplies = effectiveDate !== null && effectiveDate >= CHENGFANG_FEE_EXCLUSION_DATE;
  if (period === 'chengfang' && !ruleApplies) issues.push('chengfang_date_basis_unconfirmed');
  if (period === 'chengfang' && commissionIncluded === true && estimatedCommissionYuan === null) issues.push('estimated_commission_or_unit_unknown');
  if (period === 'chengfang' && includeLeaderServiceFee === null) issues.push('leader_service_fee_inclusion_unknown');
  if (period === 'chengfang' && includeLeaderServiceFee === true && estimatedLeaderServiceFeeYuan === null) issues.push('estimated_leader_service_fee_or_unit_unknown');
  if (period === 'uni' && includeLeaderServiceFee === true) issues.push('uni_leader_service_fee_basis_conflict');
  const includedLeaderServiceFeeYuan = includeLeaderServiceFee === false ? 0 : includeLeaderServiceFee === true ? estimatedLeaderServiceFeeYuan : null;
  const includedCommissionYuan = period === 'uni' && commissionIncluded !== true || period === 'chengfang' && commissionIncluded === false ? 0 : period === 'chengfang' && commissionIncluded === true ? estimatedCommissionYuan : null;
  const denominatorYuan = period !== 'combined' && costYuan !== null && includedCommissionYuan !== null && includedLeaderServiceFeeYuan !== null ? costYuan + includedCommissionYuan + includedLeaderServiceFeeYuan : null;
  const validBasis = period === 'uni' && commissionIncluded !== true && includeLeaderServiceFee === false || period === 'chengfang' && ruleApplies && commissionIncluded !== null && includeLeaderServiceFee !== null;
  const calculated = validBasis && denominatorYuan > 0 && Number.isFinite(denominatorYuan) && netGmvYuan !== null ? netGmvYuan / denominatorYuan : null;
  if (denominatorYuan === 0) issues.push('zero_denominator');
  const calculatedMarketingRoi = Number.isFinite(calculated) ? calculated : null;
  return { period, effectiveDate, commissionIncluded, includeLeaderServiceFee, official_marketing_roi: officialMarketingRoi,
    marketing_roi: period === 'chengfang' ? officialMarketingRoi : null,
    calculated_marketing_roi: calculatedMarketingRoi,
    cost_components: { costYuan, estimatedCommissionYuan, estimatedLeaderServiceFeeYuan, includedCommissionYuan, includedLeaderServiceFeeYuan, denominatorYuan,
      ecommerceTechnicalServiceFeeIncluded: period === 'chengfang' && ruleApplies ? false : null },
    netGmvYuan, metricBasis: { numerator: 'net_gmv', denominator: period === 'combined' ? null : includeLeaderServiceFee === true && commissionIncluded === true ? 'ad_cost_plus_estimated_commission_and_leader_service_fee' : includeLeaderServiceFee === true && commissionIncluded === false ? 'ad_cost_plus_estimated_leader_service_fee' : includeLeaderServiceFee === false && (period === 'uni' || commissionIncluded === false) ? 'ad_cost' : includeLeaderServiceFee === false && commissionIncluded === true ? 'ad_cost_plus_estimated_commission' : null,
      selected: period === 'chengfang' && officialMarketingRoi !== null ? 'official' : null,
      commissionCostType: 'estimated', feeExclusionEffectiveDate: CHENGFANG_FEE_EXCLUSION_DATE },
    units, source: input.source ?? null, issues };
}

/** binding must identify this exact material's account/product/douyin/material.
 * xingxuan: taskValid, productIds, enabled, agreementAccepted, douyinType.
 * affiliate: authorized, autoDeliveryEnabled, doubleCommissionSelected;
 * when selected: merchantDoubleCommissionEnabled, effectiveFrom/effectiveUntil,
 * deliveryCommissionActive, productShopId/accountShopId, format (video/live).
 * now/effective timestamps require an explicit timezone or epoch milliseconds.
 */
export function assessChengfangSupply(context = {}) {
  const checks = [];
  const check = (code, passed, message, evidence) => checks.push({ code, state: passed === true ? 'pass' : passed === false ? 'blocked' : 'unknown', message, evidence });
  const flag = (obj, key, message) => check(key, typeof obj[key] === 'boolean' ? obj[key] : null, message, obj[key] ?? null);
  const binding = context.binding ?? {};
  for (const key of ['accountId', 'productId', 'douyinId', 'materialId']) {
    const expected = platformId(context[key]), actual = platformId(binding[key]);
    const label = { accountId: '账户', productId: '商品', douyinId: '抖音号', materialId: '素材' }[key];
    check(`${key}_binding`, expected && actual ? expected === actual : null, !expected || !actual ? `当前${label}或素材绑定${label}信息缺失` : expected === actual ? `当前${label}与素材绑定一致` : `当前${label}与素材绑定不一致`, { expected, actual });
  }
  const source = ['own', 'xingxuan', 'affiliate'].includes(context.source) ? context.source : null;
  check('source', source ? true : null, '素材来源需明确为自有、星选或联盟达人', context.source ?? null);
  if (source === 'own') flag(context, 'authorized', '自有素材投放授权状态');
  if (source === 'xingxuan') {
    const x = context.xingxuan ?? {};
    flag(x, 'taskValid', '星选任务当前有效');
    flag(x, 'agreementAccepted', '已确认星选协议');
    flag(x, 'enabled', '计划已勾选星选素材投放');
    check('xingxuan_product', id(context.productId) && Array.isArray(x.productIds) ? x.productIds.includes(context.productId) : null, '当前商品已绑定星选任务', x.productIds ?? null);
    check('xingxuan_douyin_type', id(x.douyinType) ? ['official', 'self_operated_authorized'].includes(x.douyinType) : null, '星选投放抖音号为官方或自运营授权类型', x.douyinType ?? null);
  }
  if (source === 'affiliate') {
    const a = context.affiliate ?? {};
    flag(a, 'authorized', '联盟达人素材投放授权状态');
    if(context.deliveryMode==='auto')flag(a, 'autoDeliveryEnabled', '计划联盟合作达人自动投开关状态');
    check('double_commission_selection', typeof a.doubleCommissionSelected === 'boolean' ? true : null, '当前素材的双佣金结算模式已明确', a.doubleCommissionSelected ?? null);
    if (a.doubleCommissionSelected === true) {
      flag(a, 'merchantDoubleCommissionEnabled', '商品已设置双佣金');
      flag(a, 'deliveryCommissionActive', '当前素材投放期佣金已生效');
      const now = time(context.now), from = time(a.effectiveFrom), until = a.effectiveUntil == null ? null : time(a.effectiveUntil);
      const validRange = from !== null && (a.effectiveUntil == null || until !== null && until > from);
      check('double_commission_time', now !== null && validRange ? now >= from && (until === null || now < until) : null, '当前时间处于素材双佣金有效期', { now, from, until });
      const productShopId = platformId(a.productShopId), accountShopId = platformId(a.accountShopId);
      check('shop_binding', productShopId && accountShopId ? productShopId === accountShopId : null, '商品所属店铺与投放账户绑定店铺一致', { productShopId, accountShopId });
      check('double_commission_format', id(a.format) ? ['video', 'live'].includes(a.format) : null, '投放期佣金适用于视频或直播体裁', a.format ?? null);
    }
  }
  return { source, state: checks.some(c => c.state === 'blocked') ? 'blocked' : checks.some(c => c.state === 'unknown') ? 'unknown' : 'eligible', checks,
    commission: { estimatedCommissionYuan: context.commission?.units === 'yuan' ? amount(context.commission?.estimatedCommissionYuan) : null,
      settledCommissionYuan: context.commission?.units === 'yuan' ? amount(context.commission?.settledCommissionYuan) : null,
      estimateBasis: 'historical_product_douyin_or_similar_30_days', settlementBasis: 'order_receipt_and_settlement' } };
}

/** evidence[field] = {value, source, observedAt, scope:{accountId,planId?}}.
 * scope.level = account|plan|material; plan/material also require planId.
 * budget and spend fields use yuan. Evidence units must be 'yuan'.
 * recentAdjustments value = [{kind:'roi'|'status',from,to,at}].
 */
export function diagnoseChengfang(context = {}) {
  const findings = [], actions = [], gaps = [];
  const scope = context.scope ?? {}, evidence = context.evidence ?? {};
  const scopeValid = ['account', 'plan', 'material'].includes(scope.level) && id(scope.accountId) && (scope.level === 'account' || id(scope.planId)) && (scope.level !== 'material' || id(scope.materialId));
  const read = (field, monetary = false) => {
    const e = evidence[field];
    const matches = scopeValid && e?.scope?.accountId === scope.accountId && (scope.level === 'account' || e?.scope?.planId === scope.planId) && (scope.level !== 'material' || e?.scope?.materialId === scope.materialId);
    if (!matches || !id(e?.source) || time(e?.observedAt) === null || monetary && e.units !== 'yuan') { if (e !== undefined) gaps.push(field); return null; }
    return e;
  };
  const add = (code, message, fields, action) => { findings.push({ code, message, evidence: fields.map(field => ({ field, ...evidence[field] })) }); if (action) actions.push({ code, message: action, evidenceFields: fields, execution: 'suggestion_only' }); };
  const balance = read('balanceYuan', true);
  if (balance && amount(balance.value) === 0) add('balance_zero', '账户可用余额为0元。', ['balanceYuan'], '为该账户安排充值后再观察投放恢复情况。');
  for (const prefix of ['account', 'plan']) {
    if (prefix === 'plan' && scope.level === 'account') continue;
    const budgetField = `${prefix}BudgetYuan`, spendField = `${prefix}SpendYuan`, budget = read(budgetField, true), spend = read(spendField, true);
    if (budget && spend && amount(budget.value) !== null && amount(spend.value) !== null && budget.periodKey && budget.periodKey === spend.periodKey && spend.value >= budget.value) {
      const label = prefix === 'account' ? '账户' : '计划';
      add(`${prefix}_budget_reached`, `${label}本期消耗${spend.value}元，已达到${budget.value}元预算。`, [budgetField, spendField], `结合剩余经营预算评估是否提高${label}预算。`);
    }
  }
  const materials = read('availableMaterialCount');
  if (materials && Number.isInteger(materials.value) && materials.value === 0) add('no_available_material', '当前范围可投素材数量为0。', ['availableMaterialCount'], '核对该范围素材的授权、商品关联和生效状态，补充可投素材。');
  const materialState = read('materialState');
  const materialStates = { unauthorized: ['当前素材未获得投放授权。', '取得该素材对应抖音号的投放授权后再评估投放。'], rejected: ['当前素材审核未通过。', '根据该素材的审核原因修改内容或选择已通过审核的素材。'], expired: ['当前素材授权已到期。', '评估续期该素材授权或替换为授权有效的素材。'], pending_review: ['当前素材正在审核。', null] };
  if (materialState && Object.hasOwn(materialStates, materialState.value)) {
    const [message, action] = materialStates[materialState.value];
    add(`material_${materialState.value}`, message, ['materialState'], action);
  }
  const status = read('deliveryStatus');
  if (status?.value === 'paused') add('delivery_paused', '当前投放状态为暂停。', ['deliveryStatus'], '结合本次暂停目的评估是否恢复投放。');
  const changes = read('recentAdjustments');
  if (changes && Array.isArray(changes.value)) for (const c of changes.value) {
    if (!c || time(c.at) === null || c.from === c.to) continue;
    if (c.kind === 'roi' && amount(c.from) !== null && amount(c.to) !== null) add('roi_changed', `ROI目标在${c.at}由${c.from}调整为${c.to}。`, ['recentAdjustments']);
    if (c.kind === 'status' && ['active', 'paused'].includes(c.from) && ['active', 'paused'].includes(c.to)) add('status_changed', `投放状态在${c.at}由${c.from === 'active' ? '投放中' : '暂停'}改为${c.to === 'active' ? '投放中' : '暂停'}。`, ['recentAdjustments']);
  }
  return { scope: { ...scope }, findings, actions, gaps: [...new Set(gaps)] };
}

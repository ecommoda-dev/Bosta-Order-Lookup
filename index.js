// ══════════════════════════════════════════════════════════════
// §HEADER
// Worker: bosta-order-lookup-worker — EcomModa
// skills: worker-builder v3.0.0 · html-builder v7.0.0 · bosta-api-helper v1.1.0 · constants v2.1.0 · shopify-graphql-helper v2.1.0 — 12-09-2026
//
// WORKER_VERSION 2.0.0 — إعادة بناء كاملة على قواعد worker-builder v3.0.0.
// النسخة السابقة (1.0.0) كانت منقولة بايت-ببايت من الداشبورد وكانت:
//   • بلا WORKER_SECRET     → /sync مفتوح للعالم، وبيكتب ميتافيلدز من بيانات العميل
//   • بلا shopifyGQL        → خطأ GraphQL علوي كان بيترجع "نجاح"
//   • بلا تحقق من اسم الأوردر → البحث بالاسم ممكن يكتب على أوردر تاني
//   • businessReference بلا '#' → بحث بوسطة بيرجع صفر نتايج في صمت
//   • STATE_MAP ناقصة ٦ أكواد → حالة غلط بتتكتب على شوبيفاي
//
// Endpoints:
//   GET  ?action=lookup&order=<ref>   → بحث عن شحنة بوسطة بالـ Business Reference
//   POST ?action=sync                 → مزامنة ٤ ميتافيلدز على أوردر Shopify
//   + §AUTH (٦ endpoints) · §LOG-ENDPOINTS (٣) · diag · get_config
//
// Secrets (Dashboard → Settings → Variables → Secret → ثم Promote):
//   WORKER_SECRET · BOSTA_API_KEY · CLIENT_ID · CLIENT_SECRET
// Vars ([vars] في wrangler.toml):
//   SHOP_DOMAIN
// Bindings:
//   DB → D1 (ecommoda-dev-logs)
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════════════
const WORKER_VERSION = '2.0.0';

// قيمة `tool` في جدول logs — ecommoda-constants §7
const TOOL_NAME = 'bosta_lookup';

// الـ Worker ده بيخدم واجهة واحدة بس. القايمة البيضاء **مقفولة** — `appId`
// جاي من العميل وجدول `logs` مشترك بين كل أدوات الستاك.
const AUTH_APPS = new Set([TOOL_NAME]);
function resolveAuthTool(appId) { return AUTH_APPS.has(appId) ? appId : TOOL_NAME; }

// Bosta — EcomModa عندها **حساب واحد** (constants §3 · bosta-api-helper Step 0a).
// ممنوع أي مفتاح بلاحقة 1ry/2ry هنا — ده بتاع Khiam Store.
const BOSTA_API_BASE = 'https://app.bosta.co/api/v2';

const SHOPIFY_API_VERSION = '2026-01';   // صريح دايمًا، أبدًا "latest"

// ══════════════════════════════════════════════════════════════
// §CORS — Option B (أداة بتكتب على شوبيفاي → قائمة مصادر صارمة)
// النسخة القديمة كانت wildcard '*' على endpoint كتابة بلا أي مصادقة.
// ══════════════════════════════════════════════════════════════
const ALLOWED_ORIGINS = [
  'https://ecommoda-dev.github.io',
];
function getCORS(request) {
  const origin  = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// ══════════════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════════════
function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, request ? getCORS(request) : { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0] });
  return new Response(JSON.stringify(data), { status, headers });
}

// ─── §HELPERS::time — توقيت القاهرة يتحسب، مايتكتبش ثابت ───
// ⚠️ نفس الدوال بالحرف في الواجهة — ecommoda-constants §13 هي المصدر.
//    ممنوع أي ثابت إزاحة مكتوب بالأرقام في أي مكان.
const CAIRO_TZ = 'Africa/Cairo';
const _cairoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO_TZ, hourCycle: 'h23',
  year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
function cairoParts(d) {
  const o = {};
  for (const p of _cairoFmt.formatToParts(d)) if (p.type !== 'literal') o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';        // حارس: بعض المحركات بترجّع 24
  return o;
}
function cairoDate() { const p = cairoParts(new Date()); return `${p.year}-${p.month}-${p.day}`; }

// ─── §HELPERS::assertEnv ───
// متغير ناقص لازم يوقف العملية برسالة **باسمه**. SHOP_DOMAIN الناقص بيدّي
// "error code: 1003 is not valid JSON" — رسالة مالهاش أي علاقة بالسبب.
const ENV_REQUIRED = {
  shopify: ['SHOP_DOMAIN', 'CLIENT_ID', 'CLIENT_SECRET'],
  bosta:   ['BOSTA_API_KEY'],
};

function assertEnv(env, ...groups) {
  const missing = [];
  for (const g of groups) {
    for (const key of (ENV_REQUIRED[g] || [])) {
      if (env[key] === undefined || env[key] === null || String(env[key]).trim() === '') missing.push(key);
    }
  }
  if (!env.DB) missing.push('DB (D1 binding)');
  if (missing.length) {
    throw new Error(
      `متغيرات ناقصة في الـ Worker: ${missing.join('، ')} — ضِفها من ` +
      `Dashboard → Settings → Variables ثم Promote النسخة. (شغّل ?action=diag)`
    );
  }
}

// ══════════════════════════════════════════════════════════════
// §SHARED — copy verbatim from ecommoda-worker-builder
//           references/shared-functions.md — never modify
// ══════════════════════════════════════════════════════════════

/**
 * Verify employee and return display_name if correct.
 * Updates last_login automatically.
 * Returns: string (display_name) or null if wrong PIN.
 * Throws: Error if account is suspended.
 */
async function verifyEmployee(db, username, pin) {
  const row = await db.prepare(
    'SELECT display_name, is_active FROM employees WHERE username = ? AND pin = ?'
  ).bind(username, pin).first();

  if (!row) return null;

  if (!row.is_active) {
    throw new Error('الحساب موقوف — تواصل مع المسؤول');
  }

  db.prepare('UPDATE employees SET last_login = ? WHERE username = ?')
    .bind(new Date().toISOString(), username)
    .run()
    .catch(() => {});

  return row.display_name;
}

/**
 * Check if employee exists and has a PIN registered.
 * Used in Login screen to decide: normal login vs first-time PIN setup.
 */
async function checkEmployee(db, username) {
  const row = await db.prepare(
    'SELECT is_active, pin FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row) return { exists: false, hasPin: false, isActive: false };
  return {
    exists:   true,
    hasPin:   !!row.pin,
    isActive: !!row.is_active,
  };
}

/**
 * Register PIN for the first time.
 * Throws if: user not found / suspended / already has PIN.
 */
async function registerPin(db, username, pin) {
  const row = await db.prepare(
    'SELECT pin, is_active FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row)           throw new Error('اسم المستخدم غير موجود');
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  if (row.pin)        throw new Error('هذا المستخدم مسجّل بالفعل — تواصل مع المسؤول لإعادة الضبط');

  await db.prepare('UPDATE employees SET pin = ? WHERE username = ?')
    .bind(pin, username)
    .run();

  return true;
}

/**
 * Write a log entry to D1.
 * Only tool and type are required. All other fields optional (null if not provided).
 */
async function writeLog(db, entry) {
  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    entry.extra ? JSON.stringify(entry.extra) : null
  ).run();
}

const LOG_EXPORT_MAX = 2000;   // سقف التصدير — بيرجع للواجهة كـ `cap`

/**
 * بنّاء شرط الفلترة الموحّد للسجل — التلات دوال تحته بتستخدمه، فمفيش SQL
 * مكرر يتعتّق في واحدة منهم ويسيب التانية.
 */
function buildLogFilterSQL(select, {
  tool      = null,
  employee  = null, employees = null,
  type      = null, types     = null,
  search    = null,
  dateFrom  = null, dateTo    = null,
} = {}) {
  let sql = `${select} FROM logs WHERE type NOT IN ('login','logout')`;
  const b = [];

  const emps = Array.isArray(employees) && employees.length ? employees : (employee ? [employee] : []);
  const typs = Array.isArray(types)     && types.length     ? types     : (type     ? [type]     : []);

  if (tool) { sql += ' AND tool = ?'; b.push(tool); }
  if (emps.length) {
    sql += ` AND employee IN (${emps.map(() => '?').join(',')})`; b.push(...emps);
  }
  if (typs.length) {
    sql += ` AND type IN (${typs.map(() => '?').join(',')})`; b.push(...typs);
  }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }
  if (dateFrom) { sql += ' AND substr(timestamp, 1, 10) >= ?'; b.push(dateFrom); }
  if (dateTo)   { sql += ' AND substr(timestamp, 1, 10) <= ?'; b.push(dateTo); }

  return { sql, b };
}

/**
 * Fetch logs from D1 with server-side filtering + pagination.
 * Max limit per page: 100 (enforced server-side).
 */
async function getLogs(db, { limit = 100, offset = 0, sortBy, sortDir, ...filters } = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT *', filters);
  const q = sql + orderByClause(sortBy, sortDir) + ' LIMIT ? OFFSET ?';
  return (await db.prepare(q)
    .bind(...b, Math.min(limit, 100), Math.max(offset, 0)).all()).results;
}

// ⚠️ قائمة **مقفولة** — القيمة جاية من العميل وبتتلزق في نص SQL مباشرةً
//    (ORDER BY مابيقبلش bind). أي قيمة بره القايمة بترجع للافتراضي بدون خطأ.
// ⚠️ المفاتيح لازم تطابق `data-sort-key` في الواجهة **حرفيًا**.
const LOG_SORT_COLUMNS = {
  date: 'timestamp', time: 'timestamp', employee: 'employee', orderName: 'order_name',
  machine: `json_extract(extra, '$.machine')`, result: `json_extract(extra, '$.result')`,
};

function orderByClause(sortBy, sortDir) {
  const col = LOG_SORT_COLUMNS[String(sortBy || '')] || 'timestamp';
  const dir = String(sortDir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // 🔴 كاسر تعادل إلزامي: من غيره صفوف نفس القيمة بترتيب عشوائي بين الصفحات.
  return col === 'timestamp' ? ` ORDER BY timestamp ${dir}`
                             : ` ORDER BY ${col} ${dir}, timestamp DESC`;
}

/**
 * Count total matching log rows.
 */
async function getLogsCount(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT COUNT(*) as total', filters);
  const row = await db.prepare(sql).bind(...b).first();
  return row?.total ?? 0;
}

/**
 * Fetch all matching logs for XLSX export — up to LOG_EXPORT_MAX rows.
 * ⚠️ بتقص في السكوت — الـ endpoint لازم يرجّع cap/total/truncated كمان.
 */
async function getLogsExport(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT *', filters);
  const q = sql + ' ORDER BY timestamp DESC LIMIT ?';
  return (await db.prepare(q).bind(...b, LOG_EXPORT_MAX).all()).results;
}

/**
 * بيقرا فلاتر السجل من الـ query string — CSV للقوايم.
 */
function logParamsFrom(url, tool) {
  const csv = (k) => (url.searchParams.get(k) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const employees = csv('employees'), types = csv('types');
  return {
    tool,
    employees: employees.length ? employees : null,
    employee:  url.searchParams.get('employee') || null,
    types:     types.length ? types : null,
    type:      url.searchParams.get('type')     || null,
    search:    url.searchParams.get('search')   || null,
    dateFrom:  url.searchParams.get('dateFrom') || null,
    dateTo:    url.searchParams.get('dateTo')   || null,
  };
}

// ══════════════════════════════════════════════════════════════
// END SHARED BLOCK
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════════════
async function getAccessToken(env) {
  const resp = await fetch(
    `https://${env.SHOP_DOMAIN}/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     env.CLIENT_ID,
        client_secret: env.CLIENT_SECRET,
        grant_type:    'client_credentials',
      }),
    }
  );
  if (!resp.ok) throw new Error(`OAuth failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.access_token) throw new Error('No access_token in response');
  return data.access_token;
}

// ─── §SHOPIFY::shopifyGQL — العقد الإلزامي، منسوخة كما هي ───
// أي فشل بيترمي. مفيش رد بيعدّي وهو فاشل:
//   ① فشل شبكة  ② HTTP status  ③ رد مش JSON  ④ data.errors  ⑤ data فاضية
// ⚠️ ④ هو الخطير: لما ميوتيشن تترفض على مستوى الحقل (صلاحية ناقصة مثلاً)
// شوبيفاي بترد {"errors":[…],"data":null} — والـ userErrors بتبقى [] لأن مفيش
// payload أصلاً. كود بيفحص userErrors بس بيقرا ده **نجاح**.
async function shopifyGQL(env, token, query, variables = {}, opName = 'shopify') {
  const MAX_ATTEMPTS = 3;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp, text;
    try {
      resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body:    JSON.stringify({ query, variables }),
      });
      text = await resp.text();
    } catch (e) {
      lastErr = new Error(`${opName}: فشل الاتصال بشوبيفاي — ${e.message}`);
      if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 400 * attempt)); continue; }
      throw lastErr;
    }

    if (!resp.ok) {
      const retriable = resp.status === 429 || resp.status >= 500;
      lastErr = new Error(`${opName}: شوبيفاي ردّت HTTP ${resp.status} — ${text.slice(0, 180)}`);
      if (retriable && attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 700 * attempt)); continue; }
      throw lastErr;
    }

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`${opName}: رد شوبيفاي مش JSON صالح — ${text.slice(0, 180)}`); }

    if (Array.isArray(data.errors) && data.errors.length) {
      const codes = data.errors.map(e => e?.extensions?.code).filter(Boolean);
      lastErr = new Error(
        `${opName}: ${data.errors.map(e => e.message).join(' | ')}` +
        (codes.length ? ` [${codes.join(',')}]` : '')
      );
      if (codes.includes('THROTTLED') && attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 1200 * attempt)); continue;
      }
      throw lastErr;
    }

    if (!data.data) throw new Error(`${opName}: رد شوبيفاي بدون data — ${text.slice(0, 180)}`);
    return data;
  }
  throw lastErr || new Error(`${opName}: فشل غير معروف`);
}

// ─── §SHOPIFY::findOrderByName ───
// 🔴 البحث بالاسم **بحث، مش lookup بمفتاح** (shopify-graphql-helper).
//    `orders(query:"name:#1780")` ممكن ترجّع أوردر تاني — والنسخة القديمة كانت
//    بتاخد أول نتيجة على طول وتكتب عليها. المقارنة الحرفية تحت إلزامية.
async function findOrderByName(env, token, orderNumber) {
  const clean = String(orderNumber).replace(/^#/, '').trim();
  const wanted = `#${clean}`;
  const query = `
    query findOrder($q: String!) {
      orders(first: 5, query: $q) {
        nodes { id legacyResourceId name }
      }
    }`;
  const data  = await shopifyGQL(env, token, query, { q: `name:${wanted}` }, 'findOrderByName');
  const nodes = data.data?.orders?.nodes || [];

  // تطابق حرفي على الاسم — أي نتيجة تانية بترجع من البحث بتتجاهل
  const exact = nodes.filter(n => n.name === wanted);
  if (exact.length === 0) return { order: null, candidates: nodes.length };
  if (exact.length > 1) {
    // مستحيل نظريًا (الاسم فريد) — لكن لو حصل، الكتابة على واحد منهم تخمين
    throw new Error(`findOrderByName: أكتر من أوردر بنفس الاسم ${wanted} — متوقفين قبل أي كتابة`);
  }
  return { order: exact[0], candidates: nodes.length };
}

// ─── §SHOPIFY::setMetafields ───
// كل ميوتيشن بتعدّي تلات فحوصات: ① top-level (جوّه shopifyGQL) ② userErrors
// ③ تأكيد الـ payload — `userErrors: []` معناها "مفيش اعتراض"، مش "اتنفّذت".
async function setMetafields(env, token, metafields) {
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key value }
        userErrors { field message }
      }
    }`;
  const data   = await shopifyGQL(env, token, mutation, { metafields }, 'metafieldsSet');
  const result = data.data?.metafieldsSet;
  const errs   = result?.userErrors || [];
  if (errs.length) {
    throw new Error('metafieldsSet: ' + errs.map(e => `${(e.field || []).join('.')}: ${e.message}`).join(' | '));
  }
  // ③ الفحص اللي بيتنسى — العدّ من رد شوبيفاي مش من عدد المدخلات
  const written = result?.metafields || [];
  if (written.length !== metafields.length) {
    throw new Error(
      `metafieldsSet: شوبيفاي أكدت ${written.length} من ${metafields.length} ميتافيلد — العملية مش مكتملة`
    );
  }
  return written;
}

// ══════════════════════════════════════════════════════════════
// §BOSTA
// ══════════════════════════════════════════════════════════════

// ⚠️ STATE_MAP كاملة — bosta-api-helper Step 3.
//    `state.value` بيرجّع "Delivered" لكود ٤٥ **و٤٦** الاتنين، فالاعتماد عليه
//    بيخلط "اتسلّمت" بـ"رجعت للتاجر". أي كود ناقص هنا بيقع على نفس الـ fallback.
const STATE_MAP = {
  10:  'Pickup requested',
  11:  'Waiting for route',
  20:  'Route Assigned',
  21:  'Picked up from business',
  22:  'Picking up from consignee',
  23:  'Picked up from consignee',
  24:  'Received at warehouse',
  25:  'Fulfilled',
  30:  'In transit between Hubs',
  40:  'Picking up',
  41:  'Picked up',
  45:  'Delivered',
  46:  'Returned to business',   // ⚠️ state.value بتاعته كمان "Delivered"
  47:  'Exception',
  48:  'Terminated',
  49:  'Canceled',
  60:  'Returned to stock',
  100: 'Lost',
  101: 'Damaged',
  102: 'Investigation',
  103: 'Awaiting your action',
  104: 'Archived',
  105: 'On hold',
};

function stateLabel(delivery) {
  const code = delivery?.state?.code;
  return STATE_MAP[code] || delivery?.state?.value || 'Unknown';
}

// الـ ٤ أشكال المختلفة لرد بوسطة — bosta-api-helper Step 4
function extractDeliveries(raw) {
  if (!raw) return [];
  if (Array.isArray(raw?.data?.deliveries)) return raw.data.deliveries;
  if (Array.isArray(raw?.data))             return raw.data;
  if (Array.isArray(raw?.deliveries))       return raw.deliveries;
  if (raw?.trackingNumber)                  return [raw];
  return [];
}

// ─── §BOSTA::searchByReference ───
// 🔴 الهاش إلزامي — `businessReference: '4066'` بترجع صفر نتايج **بلا أي خطأ**.
//    النسخة القديمة كانت بتبعت الرقم زي ما الموظف كتبه بالظبط.
// ⚠️ الفشل بيترمي — تخطّي الرد الفاشل أو ابتلاعه في catch فاضي بيحوّلوا
//    "مفتاح غلط / بوسطة واقعة" لـ "الشحنة غير موجودة"، وهي رسالة كاذبة.
async function searchByReference(env, orderNumber) {
  const clean = String(orderNumber).replace(/^#/, '').trim();
  let resp, text;
  try {
    resp = await fetch(`${BOSTA_API_BASE}/deliveries/search`, {
      method: 'POST',
      // ⚠️ مفتاح خام بدون "Bearer" — ده بوسطة مش شوبيفاي
      headers: { 'Authorization': env.BOSTA_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessReference: `#${clean}`, limit: 50, page: 1 }),
    });
    text = await resp.text();
  } catch (e) {
    throw new Error(`بوسطة: فشل الاتصال — ${e.message}`);
  }
  if (!resp.ok) {
    throw new Error(`بوسطة ردّت HTTP ${resp.status} — ${text.slice(0, 180)}`);
  }
  let raw;
  try { raw = JSON.parse(text); }
  catch { throw new Error(`بوسطة: رد مش JSON صالح — ${text.slice(0, 180)}`); }

  return extractDeliveries(raw);
}

// الحقول اللي الواجهة بتعرضها — بنرجّع شكل مستقر بدل الـ raw الكامل،
// ومعاه الـ raw عشان تاب "Raw Payload".
function shapeDelivery(d) {
  return {
    trackingNumber:    d.trackingNumber ?? null,
    businessReference: d.businessReference ?? null,
    stateCode:         d.state?.code ?? null,
    stateLabel:        stateLabel(d),
    maskedState:       d.maskedState ?? null,
    type:              d.type?.value ?? d.type ?? null,
    cod:               d.cod ?? null,
    attempts:          d.numberOfAttempts ?? d.noOfAttempts ?? null,
    createdAt:         d.createdAt ?? null,
    updatedAt:         d.updatedAt ?? null,
    scheduledAt:       d.scheduledAt ?? null,
    promiseDate:       d.deliveryPromiseDate ?? null,
    notes:             d.notes ?? null,
    exceptionReason:   d.exceptionReason ?? null,
    exceptionCode:     d.exceptionCode ?? null,
    receiverName:      d.receiver?.fullName
                       || [d.receiver?.firstName, d.receiver?.lastName].filter(Boolean).join(' ')
                       || null,
    receiverPhone:     d.receiver?.phone ?? null,
    address:           d.dropOffAddress?.firstLine ?? null,
    city:              d.dropOffAddress?.city?.name ?? null,
    zone:              d.dropOffAddress?.zone?.name ?? null,
    district:          d.dropOffAddress?.district?.name ?? d.dropOffAddress?.district ?? null,
    raw:               d,
  };
}

// ══════════════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    // ALWAYS first: CORS preflight
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: getCORS(request) });

    // 🔴 حارس السر الغايب — **قبل** فحص الـ auth بالظبط.
    //    من غيره القالب بينتج السلسلة الحرفية "Bearer undefined"، يعني أي طلب
    //    معاه الهيدر ده **بيعدّي**. والحالة مش نظرية: سر اتضاف من غير Promote.
    if (typeof env.WORKER_SECRET !== 'string' || !env.WORKER_SECRET.trim())
      return json({ ok: false, error: 'WORKER_SECRET غير مضبوط على الـ Worker', step: 'env' }, 500, request);

    // ALWAYS second: WORKER_SECRET check
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`)
      return json({ error: 'Unauthorized' }, 401, request);

    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {

      // ─── §AUTH ────────────────────────────────────────────────────
      if (action === 'check_employee') {
        const username = url.searchParams.get('username');
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);
        const result = await checkEmployee(env.DB, username);
        return json({ ok: true, ...result }, 200, request);
      }

      if (action === 'register_pin') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);
        await registerPin(env.DB, username, pin);
        return json({ ok: true }, 200, request);
      }

      if (action === 'verify_employee') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        const { username, pin, appId } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);

        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401, request);

        // ⚠️ الدخول نفسه نجح فعلاً هنا. فشل D1 بعد كده بيترجع كـ logged:false
        // مش بيسقّط الرد كله على 500 لدخول حصل فعلاً (Step 5A ⑦).
        let logged = true;
        try {
          await writeLog(env.DB, {
            tool:     resolveAuthTool(appId),
            type:     'login',
            employee: username,
            notes:    `دخول: ${displayName}`,
          });
        } catch (e) {
          logged = false;
        }
        return json({ ok: true, displayName, logged }, 200, request);
      }

      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        const appId    = url.searchParams.get('appId');
        let logged = true;
        if (username) {
          try {
            await writeLog(env.DB, {
              tool:     resolveAuthTool(appId),
              type:     'logout',
              employee: username,
              notes:    `خروج: ${username.replace(/_/g, ' ')}`,
            });
          } catch (e) {
            logged = false;
          }
        }
        return json({ ok: true, logged }, 200, request);
      }

      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: results }, 200, request);
      }
      // ──────────────────────────────────────────────────────────────

      // ─── §LOOKUP ──────────────────────────────────────────────────
      // GET ?action=lookup&order=<ref>
      // عقد الترتيب: `deliveries[]` بترتيب بوسطة كما هو — الواجهة بتطابق
      // **بالـ trackingNumber** (مش بالفهرس)، والمزامنة بتبعت الرقم ده.
      if (action === 'lookup') {
        assertEnv(env, 'bosta');
        const order = url.searchParams.get('order');
        if (!order || !String(order).trim())
          return json({ ok: false, error: 'رقم الأوردر مطلوب' }, 400, request);

        const deliveries = await searchByReference(env, order);
        return json({
          ok: true,
          orderNumber: `#${String(order).replace(/^#/, '').trim()}`,
          count:       deliveries.length,
          deliveries:  deliveries.map(shapeDelivery),
        }, 200, request);
      }
      // ──────────────────────────────────────────────────────────────

      // ─── §SYNC ────────────────────────────────────────────────────
      // POST ?action=sync   body: { orderNumber, trackingNumber, employee }
      //
      // 🔴 الشحنة بتتقرا **من بوسطة من جديد هنا** — مش من body العميل.
      //    النسخة القديمة كانت بتكتب على شوبيفاي أي `delivery` العميل يبعته،
      //    يعني العميل كان بيقرر القيم المكتوبة بالكامل.
      //
      // ترتيب الأفعال (Step 5A ⑩ ①): كل تحقق ممكن يتعمل **قبل** أول كتابة —
      // الشحنة موجودة؟ الأوردر موجود بتطابق حرفي؟ القيم صالحة؟ — وبعدها بس
      // الميوتيشن. مفيش فعل لا رجعة فيه هنا أصلاً (الميتافيلدز بتتكتب فوق
      // بعضها)، بس الترتيب بيمنع كتابة جزئية على أوردر غلط.
      if (action === 'sync') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        assertEnv(env, 'shopify', 'bosta');

        const body = await request.json().catch(() => ({}));
        const { orderNumber, trackingNumber, employee } = body;
        if (!orderNumber || !trackingNumber)
          return json({ ok: false, error: 'orderNumber و trackingNumber مطلوبان' }, 400, request);

        const cleanName = `#${String(orderNumber).replace(/^#/, '').trim()}`;
        const actions   = [];          // بتتملي أول بأول — مش بترجع من دالة في الآخر
        const warnings  = [];

        // ① الشحنة — من بوسطة، مش من العميل
        const deliveries = await searchByReference(env, orderNumber);
        const delivery   = deliveries.find(d => String(d.trackingNumber) === String(trackingNumber));
        if (!delivery) {
          const res = {
            ok: true, status: 'rejected', stage: 'lookup',
            orderNumber: cleanName, orderId: null,
            message: `رقم التتبع ${trackingNumber} مش موجود على بوسطة تحت الأوردر ${cleanName} — اعمل بحث تاني`,
            actions: [],
          };
          res.logged = await safeLog(env, {
            type: 'rejected', employee, orderName: cleanName,
            notes: res.message,
            extra: { result: 'rejected', stage: 'lookup', trackingNumber },
          });
          return json(res, 200, request);
        }

        // ② الأوردر على شوبيفاي — بتطابق حرفي على الاسم
        const token = await getAccessToken(env);
        const { order, candidates } = await findOrderByName(env, token, cleanName);
        if (!order) {
          const res = {
            ok: true, status: 'rejected', stage: 'lookup',
            orderNumber: cleanName, orderId: null,
            message: candidates
              ? `البحث رجّع ${candidates} أوردر بس مفيش واحد اسمه ${cleanName} بالظبط — متوقفين قبل أي كتابة`
              : `الأوردر ${cleanName} مش موجود على شوبيفاي`,
            actions: [],
          };
          res.logged = await safeLog(env, {
            type: 'rejected', employee, orderName: cleanName,
            notes: res.message,
            extra: { result: 'rejected', stage: 'lookup', trackingNumber },
          });
          return json(res, 200, request);
        }

        // ③ بناء الميتافيلدز — القيمة الفاضية بتتشال، مش بتتبعت
        //    (`number_integer` بقيمة "" بيرفض الميوتيشن **كلها**، فالأربعة
        //     بيفشلوا بسبب حقل واحد ناقص من بوسطة)
        const label    = stateLabel(delivery);
        const orderType = String(delivery.type?.value ?? delivery.type ?? '').trim();
        const attempts = delivery.numberOfAttempts ?? delivery.noOfAttempts ?? null;
        const tn       = String(delivery.trackingNumber ?? '').trim();

        const candidatesMF = [
          { key: 'bosta_tracking_number',    value: tn,                          type: 'number_integer'         },
          { key: 'bosta_webhook',            value: label,                       type: 'single_line_text_field' },
          { key: 'bosta_order_type',         value: orderType,                   type: 'single_line_text_field' },
          { key: 'bosta_number_of_attempts', value: attempts == null ? '' : String(attempts), type: 'number_integer' },
        ];
        const metafields = candidatesMF
          .filter(m => {
            if (m.value === '') {
              warnings.push(`الحقل ${m.key} فاضي في بيانات بوسطة — ما اتكتبش`);
              return false;
            }
            if (m.type === 'number_integer' && !/^\d+$/.test(m.value)) {
              warnings.push(`الحقل ${m.key} قيمته "${m.value}" مش رقم صحيح — ما اتكتبش`);
              return false;
            }
            return true;
          })
          .map(m => ({ ...m, ownerId: order.id, namespace: 'custom' }));

        if (!metafields.length) {
          const res = {
            ok: true, status: 'rejected', stage: 'write',
            orderNumber: cleanName, orderId: order.legacyResourceId,
            message: 'مفيش أي قيمة صالحة للكتابة من بيانات بوسطة',
            actions: [], warnings,
          };
          res.logged = await safeLog(env, {
            type: 'rejected', employee, orderName: cleanName, orderId: order.legacyResourceId,
            notes: res.message,
            extra: { result: 'rejected', stage: 'write', trackingNumber: tn, warnings },
          });
          return json(res, 200, request);
        }

        // ④ الكتابة
        // ⚠️ الفشل هنا **وصل لشوبيفاي واترفض** — فلازم يسيب صف `sync` بنتيجة
        //    `error` (Step 5A ⑭: صف واحد بالظبط لكل عملية، وصفر صفوف ممنوعة).
        //    من غير الـ catch ده الاستثناء كان بيطلع للـ handler العام ويرجّع
        //    500 **بلا أي أثر في السجل** — وهي أهم حالة محتاجة أثر.
        let written;
        try {
          written = await setMetafields(env, token, metafields);
        } catch (e) {
          const failRes = {
            ok: true, status: 'error', stage: 'write',
            orderNumber: cleanName, orderId: order.legacyResourceId,
            trackingNumber: tn, actions, warnings,
            message: `الكتابة على شوبيفاي اترفضت — ${e.message}`,
          };
          failRes.logged = await safeLog(env, {
            type: 'sync', employee, orderName: cleanName, orderId: order.legacyResourceId,
            notes: failRes.message,
            extra: { result: 'error', stage: 'write', trackingNumber: tn, actions, warnings },
          });
          return json(failRes, 200, request);
        }
        actions.push(`metafieldsSet×${written.length}`);

        const status = warnings.length ? 'warning' : 'success';
        const synced = Object.fromEntries(written.map(m => [m.key, m.value]));

        const res = {
          ok: true,
          status,                                   // success | warning | error | rejected | already
          stage: 'write',
          orderNumber: cleanName,
          orderId: order.legacyResourceId,          // رقمي — الواجهة بتبني بيه لينك شوبيفاي
          trackingNumber: tn,
          stateLabel: label,
          synced,
          actions,
          warnings,
          message: warnings.length
            ? `اتكتب ${written.length} من ${candidatesMF.length} ميتافيلد — راجع التحذيرات`
            : `اتكتبت الـ ${written.length} ميتافيلدز بالكامل`,
        };
        res.logged = await safeLog(env, {
          type: 'sync', employee, orderName: cleanName, orderId: order.legacyResourceId,
          valueBefore: null, valueAfter: label,
          notes: res.message,
          extra: { result: status, stage: 'write', trackingNumber: tn, actions, warnings, synced },
        });
        return json(res, 200, request);
      }
      // ──────────────────────────────────────────────────────────────

      // ─── §LOG-ENDPOINTS ───────────────────────────────────────────
      if (action === 'get_logs') {
        const p = logParamsFrom(url, TOOL_NAME);
        // 🔴 parseInt('abc') → NaN → بيوصل لـ D1 كـ bind ويرجّع خطأ غامض.
        const limitRaw  = parseInt(url.searchParams.get('limit')  || '100', 10);
        const offsetRaw = parseInt(url.searchParams.get('offset') || '0',   10);
        const limit  = Number.isFinite(limitRaw)  ? Math.min(Math.max(limitRaw, 1), 100) : 100;
        const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

        const sortBy  = url.searchParams.get('sortBy');
        const sortDir = url.searchParams.get('sortDir');
        const entries = await getLogs(env.DB, { ...p, limit, offset, sortBy, sortDir });
        return json({ ok: true, entries }, 200, request);
      }

      if (action === 'get_logs_count') {
        const total = await getLogsCount(env.DB, logParamsFrom(url, TOOL_NAME));
        return json({ ok: true, total }, 200, request);
      }

      if (action === 'get_logs_export') {
        const p = logParamsFrom(url, TOOL_NAME);
        const [entries, total] = await Promise.all([
          getLogsExport(env.DB, p),
          getLogsCount(env.DB, p),
        ]);
        return json({ ok: true, entries, cap: LOG_EXPORT_MAX, total,
                      truncated: total > LOG_EXPORT_MAX }, 200, request);
      }
      // ──────────────────────────────────────────────────────────────

      // ─── §DIAG ────────────────────────────────────────────────────
      // ⚠️ ممنوع يرجّع قيمة أي سر — الأسماء والأطوال بس.
      // الشكل المعتمد لأي Worker جديد: مصفوفة [{ ok, label, detail }]
      if (action === 'get_config') {
        return json({ ok: true, version: WORKER_VERSION, tool: TOOL_NAME }, 200, request);
      }

      if (action === 'diag') {
        const checks = [];

        // ① المتغيرات — الأسماء والأطوال بس (بيكشف المسافة المخفية في الاسم)
        const envKeys = ['WORKER_SECRET', 'BOSTA_API_KEY', 'CLIENT_ID', 'CLIENT_SECRET', 'SHOP_DOMAIN'];
        for (const k of envKeys) {
          const v = env[k];
          const present = typeof v === 'string' && v.trim().length > 0;
          checks.push({
            ok: present,
            label: `المتغيّر ${k}`,
            detail: present ? `موجود — الطول ${String(v).length}` : 'ناقص أو فاضي',
          });
        }

        // ② D1
        try {
          const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM employees WHERE is_active = 1').first();
          checks.push({ ok: true, label: 'D1 (DB)', detail: `متصل — ${row?.n ?? 0} موظف نشط` });
        } catch (e) {
          checks.push({ ok: false, label: 'D1 (DB)', detail: `فشل: ${e.message}` });
        }

        // ③ شوبيفاي — OAuth + الصلاحيات
        try {
          const token = await getAccessToken(env);
          const d = await shopifyGQL(env, token,
            `{ currentAppInstallation { accessScopes { handle } } }`, {}, 'diagScopes');
          const scopes = (d.data?.currentAppInstallation?.accessScopes || []).map(s => s.handle);
          checks.push({ ok: true, label: 'شوبيفاي OAuth', detail: 'التوكن اتجاب بنجاح' });
          checks.push({ ok: scopes.includes('write_orders'), label: 'صلاحية write_orders',
                        detail: scopes.length ? scopes.join(', ') : 'مفيش صلاحيات راجعة' });
        } catch (e) {
          checks.push({ ok: false, label: 'شوبيفاي OAuth', detail: `فشل: ${e.message}` });
        }

        // ④ بوسطة — نداء حقيقي بمرجع مش موجود: المهم إن المفتاح مقبول
        try {
          // مرجع بشكل صالح مش موجود — الهدف إن المفتاح يتقبل، مش إن فيه نتيجة
          await searchByReference(env, '0');
          checks.push({ ok: true, label: 'بوسطة API', detail: 'المفتاح مقبول والبحث اشتغل' });
        } catch (e) {
          checks.push({ ok: false, label: 'بوسطة API', detail: `فشل: ${e.message}` });
        }

        // ⑤ الـ Origin
        const origin = request.headers.get('Origin') || '(بدون Origin)';
        checks.push({
          ok: ALLOWED_ORIGINS.includes(origin),
          label: 'الـ Origin',
          detail: `${origin} — المسموح: ${ALLOWED_ORIGINS.join(', ')}`,
        });

        return json({ ok: true, version: WORKER_VERSION, tool: TOOL_NAME,
                      cairoDate: cairoDate(), checks }, 200, request);
      }
      // ──────────────────────────────────────────────────────────────

      return json({ error: 'Unknown action' }, 404, request);
    } catch (err) {
      console.error(err);
      return json({ ok: false, error: err.message }, 500, request);
    }
  },
};

// ─── §SYNC::safeLog ───
// فشل D1 لازم يبان — `.catch(() => {})` بيخفي إن العملية حصلت بلا سجل.
// بترجّع true/false، والواجهة بتحذّر لو false.
async function safeLog(env, entry) {
  try {
    await writeLog(env.DB, { tool: TOOL_NAME, ...entry });
    return true;
  } catch (e) {
    console.error('writeLog failed:', e.message);
    return false;
  }
}

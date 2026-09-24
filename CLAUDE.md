<div dir="rtl" style="text-align: right;">

# البحث عن أوردر بوسطة (`Bosta-Order-Lookup`)

![version](https://img.shields.io/badge/version-v2.0.1-blue)

**بتعمل إيه:** البحث عن شحنة بوسطة برقم الأوردر (Business Reference) وعرض حالتها،
مع زرار لمزامنة 4 ميتافيلدز على أوردر Shopify، وسجل عمليات في D1.
**مين بيستخدمها:** مخزن / خدمة عملاء
**الإصدار:** Worker `v2.0.1` · الواجهة `v2.0.0`

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Bosta-Order-Lookup/
الـ Worker : https://bosta-order-lookup-worker.ecommoda-dev.workers.dev
اسم الـ Worker في الداشبورد: bosta-order-lookup-worker     ← لازم يطابق name في wrangler.toml
```

## الـ Endpoints

كل النداءات بقت `?action=` وكلها بتتطلّب `Authorization: Bearer <WORKER_SECRET>`.

| المسار | بيعمل إيه |
|---|---|
| `GET ?action=lookup&order=<ref>` | بحث عن شحنة بوسطة بالـ Business Reference |
| `POST ?action=sync` | مزامنة 4 ميتافيلدز (`bosta_tracking_number` · `bosta_webhook` · `bosta_order_type` · `bosta_number_of_attempts`) على أوردر Shopify |
| `GET ?action=check_employee` · `POST register_pin` · `POST verify_employee` · `GET log_logout` · `GET get_employees` | Universal D1 Auth |
| `GET ?action=get_logs` · `get_logs_count` · `get_logs_export` | سجل العمليات + التصدير |
| `GET ?action=diag` · `get_config` | الفحص الذاتي ونسخة الـ Worker |

> ⛔ **الشكل القديم اتشال في v2.0.0:** `GET /?order=` و`POST /sync` مابقوش شغالين.
> السبب إنهم كانوا **بلا أي مصادقة**، فأي حد يعرف الرابط كان يقدر يكتب ميتافيلدز
> على أي أوردر. أي أداة تانية كانت بتناديهم لازم تتحدّث (مفيش حاجة معروفة بتناديهم
> غير الواجهة دي).

## D1

**الأداة بقى فيها D1** (اتضاف 12-09-2026) — Universal D1 Auth + سجل عمليات.

```
Binding : DB → ecommoda-dev-logs (90db62d3-bd7e-4d92-912b-10fc78eeb565)
tool    : bosta_lookup
type    : sync · rejected · login · logout
```

> 🔴 **بند إلزامي مفتوح:** الصف ده لازم يتسجّل في `ecommoda-constants` §7
> **قبل** أول نشر. `bosta_lookup` مذكورة حاليًا في §11 بند 5 كأداة بلا D1 —
> البند ده بيتقفل بتسجيل القيم فوق في جدول §7 وتحديث بند 5.

### الحارس الديناميكي (الطبقة ٥ — من v2.0.1)

`writeLog` بقى بيحمي نفسه وقت التشغيل: أي `(tool, type)` مش موجود في
`LOG_REGISTRY` (مبني من `log-values.json` جنبه) بيتكتب **عادي** + يتعلّم
`extra._unregistered = true` + يتسجّل تنبيه UPSERT في `log_value_alerts`
(جدول مشترك على مستوى الستاك) — **مفيش رفض كتابة أبدًا**. التفاصيل →
`ecommoda-worker-builder` Step 7-ج. الأداة دي مالهاش `writeLogsBatch` ولا
أنكور تاني غير `writeLog` نفسها (اللي `safeLog` بتلفّها) — فالحارس في مكان
واحد بس.

### استعلام خط الأساس

```sql
-- ✅ بيقيس الكتابة الفعلية (مش المحاولات)
SELECT COUNT(*) FROM logs
WHERE tool = 'bosta_lookup' AND type = 'sync'
  AND json_extract(extra,'$.result') = 'success';
```

## المضبوط فعليًا في الداشبورد

> اللي **متظبط بالفعل** — مش اللي المفروض يكون.

```
Bindings : DB (D1)            ← جديد في v2.0.0، بيتطبّق من wrangler.toml
Secrets  : BOSTA_API_KEY · CLIENT_ID · CLIENT_SECRET
           🔴 WORKER_SECRET   ← جديد في v2.0.0، لسه محتاج يتضاف يدويًا + Promote
Vars     : SHOP_DOMAIN        ← من [vars] في wrangler.toml
Build watch paths : * الافتراضي
```

## CORS

`Option B` — قائمة مصادر صارمة: `https://ecommoda-dev.github.io` بس.

اتغيّر في v2.0.0 من `*` (wildcard). السبب: دي أداة **بتكتب** على شوبيفاي،
و`ecommoda-worker-builder` Step 3 بيفرض Option B لأي أداة كتابة. الوايلدكارد
مع غياب `WORKER_SECRET` كان معناه endpoint كتابة مفتوح للإنترنت.

## فخاخ الأداة دي

- **الـ Worker مابيثقش في بيانات الواجهة.** `sync` بياخد `trackingNumber` بس،
  وبيرجع يقرا الشحنة من بوسطة بنفسه. لو عدّلت ده وخليته ياخد كائن الشحنة من
  الـ body، بترجّع الثغرة اللي v2.0.0 اتعملت عشانها.
- **البحث بالاسم على شوبيفاي بحث مش lookup.** `findOrderByName` بتفلتر على
  تطابق حرفي (`node.name === '#1780'`) قبل أي كتابة. شيل الفلتر ده = كتابة على
  أوردر تاني من غير أي رسالة.
- **`businessReference` لازم بالهاش.** من غيرها بوسطة بترجّع صفر نتايج **بلا
  خطأ** — الـ Worker بيضيفها بنفسه دلوقتي، متشيلهاش.
- **`STATE_MAP` لازم تفضل كاملة.** `state.value` بيرجّع "Delivered" للكود ٤٥
  **و٤٦** الاتنين، فأي كود ناقص من الماب بيقع على fallback غلط ويتكتب على
  شوبيفاي.
- `SHOP_DOMAIN` مستخدم في 3 أماكن (OAuth + نداءين GraphQL) — بس بقى محروس بـ
  `assertEnv`، فالرسالة بتقول اسم المتغيّر الناقص بدل `error code: 1003`.
- **`esc()` بتستخدم `"`/`'` جوّه الـ regex عن قصد** — علامة اقتباس
  خام جوّه regex literal بتكسر فحص الربط (Step 9B) وتخلّيه يبلّغ عن دوال معرّفة
  إنها مش معرّفة. السلوك وقت التشغيل واحد.

## استرجاع النسخ القديمة

> ده بديل الـ tags — دفع الـ tags ممنوع من جلسات Claude Code السحابية.

```
النسخة الأخيرة قبل إعادة البناء (v1.0.0):
  630d11f  Update wrangler.toml        ← آخر كوميت على v1.0.0
git show 630d11f:index.js
git show 630d11f:index.html

تاريخ الواجهة قبل النقل (Index.html) على main:
  d7c81f0  Create Index.html
  81ddbfb  Update Index.html
  864cd38  Update Index.html
git show <sha>:Index.html
```

## بصمة المهارات

> الصيغة والقواعد والمهارات اللي بتدخل الجدول → `ecommoda-skill-versioning`
> Step 4. مهارة مالهاش رقم إصدار مابتدخلش الجدول.

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v3.7.0 |
| ecommoda-html-builder | v7.0.0 |
| bosta-api-helper | v1.1.0 |
| ecommoda-constants | v3.1.0 |
| shopify-graphql-helper | v2.1.0 |

آخر مطابقة: 24-09-2026 · `index.js` v2.0.1 · `index.html` v2.0.0
🔴 معلّقة: — لا شيء

## مسائل مفتوحة

- 🔴 **تسجيل `bosta_lookup` في `ecommoda-constants` §7** بالقيم
  (`sync` · `rejected` · `login` · `logout`) وتحديث §11 بند 5 — **قبل أول نشر**.
- 🔴 **إضافة `WORKER_SECRET` في الداشبورد + Promote** — الـ Worker بيرد 500
  على كل نداء لحد ما يتضاف (برسالة صريحة، مش فشل صامت).
- الموظفين لازم يكونوا موجودين في جدول `employees` وليهم PIN عشان يدخلوا.

آخر تحديث: 12-09-2026 — 14:30

</div>

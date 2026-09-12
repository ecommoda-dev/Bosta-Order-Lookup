# البحث عن أوردر بوسطة (`Bosta-Order-Lookup`)

**بتعمل إيه:** البحث عن شحنة بوسطة برقم الأوردر (Business Reference) وعرض حالتها، مع زرار لمزامنة 4 ميتافيلدز على أوردر Shopify.
**مين بيستخدمها:** مخزن / خدمة عملاء
**الإصدار:** Worker `v1.0.0` (منقول بايت-ببايت من كلاودفلير، بلا تعديل منطق) · الواجهة `v1.0.0`

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Bosta-Order-Lookup/
الـ Worker : https://bosta-order-lookup-worker.ecommoda-dev.workers.dev
اسم الـ Worker في الداشبورد: bosta-order-lookup-worker     ← لازم يطابق name في wrangler.toml
```

## الـ Endpoints

| المسار | بيعمل إيه |
|---|---|
| `GET /?order=<ref>` | بحث عن شحنة بوسطة بالـ Business Reference |
| `POST /sync` | مزامنة 4 ميتافيلدز (`bosta_tracking_number` · `bosta_webhook` · `bosta_order_type` · `bosta_number_of_attempts`) على أوردر Shopify |

## D1

**الأداة دي مفيهاش D1 خالص** — صفر `writeLog`، صفر جداول. ده تصميم قديم
مؤكَّد في `ecommoda-constants` §11 بند 5 (`bosta_lookup`) — مش نقص حصل أثناء
النقل. القرار (تترقّى تسجّل في D1 ولا تفضل كده) لسه مفتوح لأحمد.

## المضبوط فعليًا في الداشبورد

> اللي **متظبط بالفعل** — مش اللي المفروض يكون.

```
Bindings : لا يوجد (الأداة مفيهاش D1)
Secrets  : BOSTA_API_KEY · CLIENT_ID · CLIENT_SECRET
Vars     : SHOP_DOMAIN   ← من [vars] في wrangler.toml
Build watch paths : * الافتراضي
```

## CORS

`Access-Control-Allow-Origin: *` (wildcard) — الأداة أصلها كده من قبل النقل،
ولم تُعدَّل. أداة قراءة أساسًا + كتابة 4 ميتافيلدز محدودة (مش مالية مباشرة).

## خط الأساس بعد النقل

لا يوجد — لم يُسجَّل خط أساس قبل النقل، ولا يوجد D1 يُستنتج منه بديل
(§0-ب). **بند مفتوح بوعي**، وليس فشلًا.

## فخاخ الأداة دي

- **مفيهاش D1 خالص** — لو الـ sync فشل، الاعتماد على رد الـ API نفسه بس،
  مفيش أثر في أي سجل. لا تفترض وجود `writeLog` هنا زي باقي الأدوات.
- `SHOP_DOMAIN` مستخدم مباشرة من غير fallback في 3 أماكن (OAuth + نداءين
  GraphQL) — لو ضاع من `[vars]`، كل نداءات الـ Sync هترمي خطأ فورًا (مش فشل
  صامت، لكنه أول حاجة تتشك فيها لو ظهر `Token error`).

## استرجاع النسخ القديمة

> ده بديل الـ tags — دفع الـ tags ممنوع من جلسات Claude Code السحابية.

```
تاريخ الواجهة قبل النقل (Index.html) على main:
  d7c81f0  Create Index.html
  81ddbfb  Update Index.html
  864cd38  Update Index.html   ← آخر نسخة، هي نفسها index.html الجديد (نفس الـ blob)
git show <sha>:Index.html
```

## بصمة المهارات

> الصيغة والقواعد والمهارات اللي بتدخل الجدول → `ecommoda-skill-versioning`
> Step 4. مهارة مالهاش رقم إصدار مابتدخلش الجدول.

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v1.0.0 |
| ecommoda-html-builder | v1.0.0 |
| ecommoda-constants | v1.2.0 |
| shopify-graphql-helper | v1.0.0 |

آخر مطابقة: 26-08-2026 · `index.js` v1.0.0 · `index.html` v1.0.0
🔴 معلّقة: — لا شيء

## مسائل مفتوحة

- خط الأساس غير مسجَّل (شوف "خط الأساس بعد النقل" فوق) — مفتوح بوعي.
- هل الأداة دي (بلا D1) قرار تصميم نهائي، ولا مرشّحة لترقية زي باقي الأدوات؟
  (`ecommoda-constants` §11 بند 5 — قرار أحمد.)

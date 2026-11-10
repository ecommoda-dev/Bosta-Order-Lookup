<div dir="rtl" style="text-align: right;">

# تحديث مقترح لمهارة `bosta-api-helper` — الدفع الأونلاين وماليات الشحنة

**المصدر:** جلسة `Bosta-Order-Lookup` v3.5.0 → v3.5.2 (10-11-2026) · الإصدار الحالي للمهارة وقت القراءة: v6.6.0
**كله مقيس على حساب EcomModa:** Raw Payload لشحنة `#50232` + ملف التحصيل `WEDCOD12AUG26.xlsx` + لقطات داشبورد بوسطة لأوردرات `7492128372` و`7208395225` و`6271562645`.

---

## ١) ملخص التعديلات المطلوبة

| # | المكان في المهارة | التعديل |
|---|---|---|
| 1 | **8.15** — بند جديد «الدفع الأونلاين» (بعد ③) | إضافة `paymentInfo` وقاعدة الصافي المصحّحة (التفاصيل في ٢) |
| 2 | **8.15 ③** (الصافي) | تعديل المعادلة: `total_amount` + الأونلاين − `bosta_fees` (بدل `total_amount − bosta_fees` بس) |
| 3 | **8.15 ①** (جدول search ≠ GET) | إضافة صف `paymentInfo` — موجود في الاتنين |
| 4 | **8.15 ⑤** (حالة التحصيل) | إضافة إن الأونلاين بيتسوّى في نفس الـ cash-out |
| 5 | **Quick Pitfall Checklist** (قسم ماليات 8.15) | بندين جداد (في ٤) |
| 6 | **قايمة التجارب المفتوحة (Step 9)** | تجربتين جداد (في ٥) |
| 7 | **الإصدار + CHANGELOG** | رفع الإصدار ويتسجّل في `references/CHANGELOG.md` |

---

## ٢) النص المقترح للمهارة

### ٢.١ — بند جديد في 8.15 (بعد ③): الدفع الأونلاين

> **③-ب الدفع الأونلاين (`paymentInfo`) — مقيس 10-11-2026**
>
> الأوردر اللي العميل دفعه أونلاين (مش كاش عند الباب) بيرجع من بوسطة بـ **`cod: 0`** و**`wallet.cashCycle.total_amount: 0`**.
> المبلغ المدفوع **مش** في أي حقل من الاتنين، وبيرجع في كتلة مستقلة على جذر الشحنة:
>
> ```json
> "paymentInfo": {
>   "amount": 1350, "capturedStatus": "SUCCEEDED", "method": "flash",
>   "paymentOrderId": "…", "paymentType": "flash", "provider": "Flash",
>   "transactionId": "…"
> }
> ```
>
> - الكتلة **موجودة في `POST /deliveries/search` وفي `GET /deliveries/business/{tn}` الاتنين** (اتشافت في Raw Payload من `search`، فمحتاجش نداء زيادة عشان تعرف إن الأوردر أونلاين).
> - في الداشبورد بتظهر كـ «Collection Amount: EGP X · **Paid Online**»، وفي ملف التحصيل (xlsx) كعمود **`Online Payment Amount`** منفصل عن عمود `COD` (اللي بيبقى `0`).
> - 🔴 **المبلغ الأونلاين بيتسوّى في نفس الـ cash-out.** الأوردرات التلاتة في الملف `WEDCOD12AUG26` ليها نفس `oracleTransactionId` وحالة `Paid`.
> - 🔴 **الصافي = `total_amount` + `paymentInfo.amount` (لو `capturedStatus = SUCCEEDED`) − `bosta_fees`.**
>   مقيس على ٣ أوردرات من عمود `Net Value` في الملف:
>
>   | الأوردر | الأونلاين | `bosta_fees` | الصافي (Net Value) |
>   |---|---|---|---|
>   | `#49836` | 1350 | 133.95 | 1216.05 |
>   | `#49973` | 2700 | 137.94 | 2562.06 |
>   | `#50232` | 1350 | 119.13 | 1230.87 |
>
>   (الرسوم نفسها مطابقة لمعادلة ② : `(شحن + فتح طرد + تأمين) × 1.14` — مثال `#49973`: (97+7+17)×1.14 = 137.94.)
> - ⛔ **أداة بتحسب الصافي بـ `total_amount − bosta_fees` بس هتطلّع الأوردر الأونلاين بقيمة `−الرسوم`** (مثلًا −119.13 بدل +1230.87) — خطأ صامت بيبان كأن الأوردر خسارة.
> - 🟡 `paymentInfo.amount` **مش بالضرورة = `goodsInfo.amount`**: في `7492128372` الداشبورد بيعرض Product Value = 1700 والمبلغ الأونلاين = 2700 (الفرق غالبًا شحن/رسوم محصّلة من العميل أونلاين — **استنتاج، مش مقيس**). فمتستخدمش قيمة البضاعة بديل عنه.
> - ⚠️ **حدود القياس:** الـ Raw Payload الكامل اتقرا لشحنة واحدة (`#50232` — `capturedStatus: SUCCEEDED` · `provider: Flash` · `method: flash`). **قيم `capturedStatus` التانية** (فشل/معلّق/مسترد) و**قيم `provider`/`method` التانية** مش معروفة. الأداة بتحسب المبلغ في الصافي لو `SUCCEEDED` بس، وأي قيمة تانية بتتعرض حرفيًا بتحذير.

### ٢.٢ — تعديل 8.15 ③ (عنوان الصافي)

الجملة الحالية: «🔴 الصافي = `total_amount − bosta_fees` — مش `deposited_amt`»
تتبدّل بـ:

> 🔴 **الصافي = `total_amount` + (المبلغ الأونلاين لو `SUCCEEDED`) − `bosta_fees` — مش `deposited_amt`.** الأوردر الأونلاين `total_amount` بتاعه `0` (راجع ③-ب)، فالمعادلة القديمة وحدها بتطلّع سالب.

وفي جدول ③ يتضاف صف:

| الحالة | cod | total | online | fees | الصافي | = الداشبورد/الملف؟ |
|---|---|---|---|---|---|---|
| Send · Delivered · **مدفوع أونلاين** (`#50232`) | 0 | 0 | 1350 | 119.13 | 1230.87 | ✅ (Net Value في الملف) |

### ٢.٣ — تعديل 8.15 ① (جدول search ≠ GET)

يتضاف صف:

| | `POST /deliveries/search` | `GET /deliveries/business/{tn}` |
|---|---|---|
| `paymentInfo` (الدفع الأونلاين) | ✅ | ✅ |

### ٢.٤ — تعديل 8.15 ⑤ (حالة التحصيل)

يتضاف سطر:

> الأوردر المدفوع أونلاين بيبقى له `cashCycle` و`cashoutInfo.oracleTransactionId` زي الكاش، والمبلغ الأونلاين بيتسوّى في نفس الـ Transfer ID (مقيس: `WEDCOD12AUG26`). `cashoutInfo` بيرجع في `search` (مش في الـ GET) — `{ expectedCashoutDate, oracleTransactionId }`.

---

## ٣) أعمدة ملف التحصيل (xlsx) — معلومات جديدة للمهارة

الملف `WEDCOD12AUG26.xlsx` (تصدير Cash-out Receipt من داشبورد بوسطة) فيه الأعمدة دي. ⚠️ **أسماء كتير مقطوعة في اللقطة** (`Collecti…` · `Next Da…` · `0 COD…` · `Promot…` · `Fulfillm…` · `Bosta C…` · `Total Fe…` · `Paymer…`) — الأسماء الكاملة تحت **تكملة مني، مش مقروءة بالكامل** ولازم تتراجع على الملف الأصلي قبل ما تتكتب في المهارة. الأسماء اللي اتقرت كاملة: `Order Id` · `Order Reference` · `COD` · `Online Payment Amount` · `VAT` · `Net Value` · `Paid At`: `Order Id` · `Order Type` · `Order Reference` · `COD` · **`Online Payment Amount`** · `Shipping` · `Insurance` · `Collection Fees` · `Next Day Cash-out Fees` · `0 COD Fees` · `Promotion` · `POS Fees` · `COD Fees` · `Fulfillment` · `VAT` · `Bosta Credits Used` · `Opening Package Fees` · `Total Fees` · **`Net Value`** · `Payment Status` · `Paid At` · `Cash-out ID`.

- `Net Value` = المحصَّل (COD + Online) − `Total Fees` — ده المرجع اللي اتقاس عليه الصافي.
- 🟡 **ما اتشافش:** باقي الأعمدة اللي بعد `Cash-out ID` (لو فيه). ولا الصفوف الأخرى اللي مش `Send` (الفلتر كان على ٣ أوردرات بس).

---

## ٤) بنود مقترحة لـ Quick Pitfall Checklist (قسم ماليات 8.15)

- [ ] 🔴 **الأوردر المدفوع أونلاين: `cod = 0` و`total_amount = 0`** — المبلغ في `paymentInfo.amount` (موجود في `search` و`GET`)؛ الصافي = `total_amount + paymentInfo.amount (SUCCEEDED) − bosta_fees` (8.15 ③-ب)
- [ ] `paymentInfo.amount` **مش** `goodsInfo.amount` ومتتفترضش إنهم متساويين — والحالة `SUCCEEDED` شرط قبل ما المبلغ يتحسب (8.15 ③-ب)

---

## ٥) تجارب مفتوحة مقترحة لـ Step 9 (ترقيم بعد ٢٠)

| # | السؤال | النداء اللي يقفله | ملحوظة |
|---|---|---|---|
| **٢١** 🆕 | **إيه قيم `paymentInfo.capturedStatus` غير `SUCCEEDED`؟ وإيه `provider`/`method` التانيين؟** | قراية `search` لأوردرات أونلاين فاشلة/مسترجعة/معلّقة | ⬜ مفتوح — شحنة واحدة بس اتقرت (`SUCCEEDED` · Flash) |
| **٢٢** 🆕 | **أوردر أونلاين اتعمله Return/RTO — المبلغ الأونلاين بيتسترد إزاي في الـ cash-out؟** | قراية `GET` لأوردر أونلاين راجع + مقارنة بملف التحصيل | ⬜ مفتوح — الأوردرات التلاتة في العينة كلها Delivered |
| **٢٣** 🆕 | **الفرق بين `paymentInfo.amount` و`goodsInfo.amount` (مثال `7492128372`: 2700 vs 1700)** | مقارنة الـ Raw Payload لأوردر فيه فرق + Order Summary | ⬜ مفتوح — الفرق غالبًا شحن، **استنتاج** |

---

## ٦) الإصدار والـ CHANGELOG

- **الإصدار المقترح:** `v6.7.0` (إضافة قسم/بند جديد في 8.15 + تصحيح معادلة الصافي = minor).
- **سطر CHANGELOG مقترح:**
  > v6.7.0 (10-11-2026): **8.15 — الدفع الأونلاين:** `paymentInfo` (موجود في search وGET) بيشيل مبلغ الأوردر المدفوع أونلاين اللي `cod` و`total_amount` بتوعه `0`. 🔴 **تصحيح معادلة الصافي:** `total_amount + paymentInfo.amount (SUCCEEDED) − bosta_fees` — مقيس على ٣ أوردرات من `Net Value` في ملف التحصيل `WEDCOD12AUG26`. تجارب مفتوحة ٢١–٢٣. بندين في الـ Checklist.

---

## ٧) تعديلات متوقعة في مهارات تانية

- 🟡 **لا شيء مؤكَّد** في مهارات تانية. `ecommoda-constants` ممكن يحتاج صف لـ `paymentInfo` لو فيه جدول لحقول الشحنة — **مش متأكد، يتراجع في الجلسة المنفصلة.**
- `ecommoda-dashboard-builder`: أي أداة بتجمّع «المحصَّل» أو «الصافي» على مستوى الحساب لازم تحسب الأونلاين (لو بتقرا `cod` بس هتفوّت الأونلاين كله) — **تنبيه، مش تعديل مطلوب هنا.**

---

## ٨) اللي اتعمل في الأداة (للمرجع)

| الإصدار | التغيير |
|---|---|
| **v3.5.0** | قسم «💰 الماديات والتحصيل»: `lookup` بيرجّع `finance` (من `GET /deliveries/business/{tn}` لكل شحنة، حد أقصى ٥ بالتوازي، مهلة ٨ ثواني). الصافي `total_amount − bosta_fees` |
| **v3.5.1** | `finance.onlinePayment` من `paymentInfo` + بلوك «💳 مدفوع أونلاين» |
| **v3.5.2** | 🔴 تصحيح الصافي: بيشمل المبلغ الأونلاين لو `SUCCEEDED` |

**الريبو:** `ecommoda-dev/Bosta-Order-Lookup` (`index.js` و`index.html` و`CLAUDE.md`)

</div>

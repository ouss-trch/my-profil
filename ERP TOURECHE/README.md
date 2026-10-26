# ERP TOURECHE

نظام إدارة متاجر **الدفع عند الاستلام** في الجزائر: من الطلبية إلى التسليم، ومن المنتج إلى الإعلان، مع **مستشار** يحلل بياناتك ويقترح ما تفعله.
Système de gestion pour boutiques **COD** en Algérie : de la commande à la livraison, du produit à la pub, avec un **Conseiller** qui analyse vos données.

> يعمل 24/7 على **VPS** (Docker بجانب n8n، انظر أدناه) أو على جهازك (macOS / Windows / Linux)، وتفتحه من هاتفك كتطبيق.
> Tourne sur votre ordinateur et s’ouvre sur le téléphone via **Tailscale**, comme une application.

---

## الأقسام · Sections

| القسم | ماذا يفعل |
|---|---|
| **اليوم** | أولويات الآن من المستشار، مسار الطلبيات (جديدة ← لا يرد ← للشحن ← في المكتب ← مع الموزع ← مرتجعة)، أرقام اليوم، اتجاه 14 يوماً |
| **لوحة القيادة** | القمع، المالية التقديرية (الإيراد المسلّم − التكاليف − الإعلانات)، الولايات، المنتجات، المصادر، أداء الفريق |
| **المستشار** | ملاحظات وتقييمات واستنتاجات واقتراحات بالأدلة الرقمية وزر تنفيذ لكل واحدة؛ تقرير ذكي أسبوعي (Claude)؛ دفتر الدروس والقرارات |
| **المساعد الذكي** | اسأل عن أي شيء؛ يقرأ الأرقام الحقيقية، والتعديلات لا تُنفّذ إلا بموافقتك وكلمة المرور الحساسة |
| **الطلبيات** | رقم الطلبية = رقم Shopify نفسه (في القائمة والبحث وملصق شركة التوصيل) مع زر فتحها في Shopify · تأكيد سريع، إعادة الاتصال، الإلغاء بالسبب، الشحن الجماعي بأفضل شركة لكل ولاية، التتبع، تقييم الموزع |
| **شركات التوصيل** | Yalidine · NOEST · ZR Express: الأداء الحقيقي، أفضل شركة لكل ولاية (تسليم 45% · سرعة 25% · جدية الموزع 15% · سعر 15%)، الأسعار |
| **صفحات المتجر** | صفحات Shopify وصفحات المنتجات تُزامن كل ساعة؛ ثبّت ما تستعمله أو الصق روابطك (رابط في كل سطر): لكل صفحة طلبياتها ونسبة تسليمها واختبارات A/B التي تستعملها، وتظهر المثبّتة كاختيارات جاهزة في الحملات والاختبارات |
| **المنتجات** | منتجات Shopify والمنتجات قيد الإنشاء: تعديل، SEO احترافي بالذكاء الاصطناعي، صور ونصوص إعلانية، نشر، مخزون |
| **الموردون والشركاء** | المورد مربوط بمنتجاته: ماذا تطلب ومتى وكم، ورسالة الطلب جاهزة على واتساب · مكاتب وموزعو التوصيل حسب الولاية: يظهر رقمهم داخل الطلبية عندما يتعثر الطرد |
| **الإعلانات** | Business Manager ← الحسابات ← كل الحملات (نشطة، متوقفة، مرفوضة، مؤرشفة)؛ إطلاق حملة **لأي منتج**؛ تعديل؛ قرارات بالطلبيات المسلّمة لا بالبيكسل |
| **اختبار الصفحات A/B** | نفس رابط المنتج على دومين متجرك يعرض نسخاً مختلفة (زوايا تسويقية) لكل زائر، ويحكم بالطلبيات المسلّمة |
| **التحصيل** | المال الذي قبضته Yalidine و NOEST و ZR من زبائنك ولم يصلك بعد: لكل شركة الصافي (المقبوض − التوصيل − الإرجاع) وأقدم طلبية. سجّل الدفعة بلصق أرقام التتبع من كشف الشركة فتُطابَق الطلبيات ويظهر الفرق فوراً؛ والمستشار ينبّه عند تأخر الدفع أكثر من 14 يوماً. أول مرة: «رصيد افتتاحي» حتى تاريخ آخر دفعة استلمتها |
| **المالية · المهام · سجل النشاط · الإعدادات** | — |

متعدد المشاريع: كل مشروع = متجر/صفحة/دومين بإعداداته وحساباته. **«كل المشاريع»** يجمع الأرقام.

---

## التثبيت · Installation

**المتطلبات:** [Node.js 22+](https://nodejs.org) وجهاز يبقى مشغلاً.

```bash
# 1) انسخ المجلد «ERP TOURECHE» إلى جهازك ثم:
npm run setup      # يثبّت ويبني الواجهة (مرة واحدة)
npm start          # يشغّل الـ ERP على http://localhost:3600
```

أو بنقرة: `start.command` (macOS) · `start.bat` (Windows) · `start.sh` (Linux).

أول مرة تفتح الصفحة يطلب منك: حساب المدير، **كلمة مرور العمليات الحساسة** (مختلفة عن كلمة الدخول)، وأول مشروع.

### الفتح من الهاتف كتطبيق (Tailscale)

1. ثبّت [Tailscale](https://tailscale.com/download) على الجهاز وعلى الهاتف وسجّل بنفس الحساب.
2. على الجهاز: `tailscale serve --bg 3600` ← يعطيك رابطاً آمناً مثل `https://your-pc.tailXXXX.ts.net`.
   ضع `ERP_TRUST_PROXY=1` في ملف `.env`.
3. افتح الرابط على الهاتف ← «إضافة إلى الشاشة الرئيسية» ← يعمل كتطبيق بملء الشاشة.

> لا تفتح منفذ الراوتر. Tailscale يكفي ويبقي الـ ERP خاصاً بك.

### إبقاؤه شغالاً

- **macOS:** إعدادات النظام ← البطارية ← منع السكون عند توصيل الشاحن؛ أو `caffeinate -dimsu &`.
- **Windows:** خيارات الطاقة ← السكون: أبداً؛ وأضف `start.bat` إلى «برامج بدء التشغيل».
- البديل: `npx pm2 start server/index.js --name erp && npx pm2 save`.

---

## التشغيل 24/7 على VPS (Hostinger) بجانب n8n

الـ ERP يعمل في حاوية Docker مستقلة على نفس الخادم، خلف Traefik الموجود مع n8n، بدومين فرعي و HTTPS تلقائي. حاوية n8n لا تُلمس.

1. **الدومين:** أضف سجل `A` باسم `erp` (مثلاً `erp.leadsauto.cloud`) ← عنوان IP الخادم، من حيث تدير DNS الدومين. مع Cloudflare: اجعله «DNS only» حتى تصدر الشهادة.
2. **على الخادم** (hPanel ← VPS ← Browser terminal، أو SSH):
   ```bash
   cd /opt && git clone -b claude/erp-toureche-system-fdir8x https://github.com/ouss-trch/my-profil.git erp
   cd "/opt/erp/ERP TOURECHE" && bash deploy/install-vps.sh erp.leadsauto.cloud
   ```
   السكربت يقرأ إعداد Traefik من حاوية n8n (الشبكة، المنافذ، الشهادة)، يتحقق من الدومين، يبني الـ ERP ويشغّله، ثم يتأكد أنه يعمل.
3. افتح `https://erp.leadsauto.cloud` ← **رمز الإعداد** الذي طبعه السكربت (أو `bash deploy/erp.sh setup-token`) + حساب المدير + كلمة المرور الحساسة + أول مشروع. الرمز يمنع أي شخص يصل إلى الرابط قبلك من إنشاء حساب المدير، ويُحذف بعد الإعداد. في الإعدادات ضع «الرابط العام لاختبارات الصفحات» = `https://erp.leadsauto.cloud`.
4. **نقل بياناتك من الحاسوب** (إن كان لديك): انسخ آخر ملف `toureche-YYYY-MM-DD.db` وملف `data/.secret-key` إلى الخادم ثم:
   ```bash
   bash deploy/erp.sh restore /root/toureche-2026-10-26.db
   bash deploy/erp.sh import-key /root/.secret-key
   ```
5. **n8n ↔ ERP على نفس الخادم:** من n8n استعمل `http://erp-toureche:3600/api/hooks/<slug>/orders` (شبكة داخلية، أسرع ولا يمر عبر الإنترنت).

| الأمر | ماذا يفعل |
|---|---|
| `bash deploy/erp.sh update` | جلب آخر نسخة من GitHub وإعادة البناء — البيانات لا تتأثر |
| `bash deploy/erp.sh status` · `logs` | الحالة · آخر السجلات |
| `bash deploy/erp.sh backup` | نسخة احتياطية الآن |
| `bash deploy/erp.sh restore FILE.db` | استرجاع (يتحقق من الملف، يحفظ القاعدة الحالية، ويعيد تشغيل الـ ERP في كل الحالات) |
| `bash deploy/erp.sh reset-password USER PASS` | كلمة مرور منسية |
| `bash deploy/erp.sh setup-token` | رمز الإعداد الأول (قبل إنشاء حساب المدير فقط) |

**النسخ خارج الخادم:** البيانات في volume `erp-toureche_erp_data`. لنسخة يومية في Google Drive: ثبّت `rclone` واربطه بـ Drive (`rclone config`)، أضف `ERP_BACKUP_MIRROR=/offsite` إلى `deploy/.env` ثم `bash deploy/erp.sh update`، وأضف إلى `crontab -e`:
`30 3 * * * rclone copy "/opt/erp/ERP TOURECHE/deploy/offsite" gdrive:ERP-backups`
وفعّل أيضاً النسخ الاحتياطي للـ VPS من hPanel.

---

## الربط · Intégrations (الإعدادات ← تكاملات المشروع)

| الخدمة | ما تحتاجه |
|---|---|
| **Shopify** | تطبيق من **Dev Dashboard** (لم يعد Shopify يسمح بإنشاء تطبيقات من لوحة المتجر) بالصلاحيات: `read/write_products`, `read/write_orders`, `read/write_inventory`, `read/write_themes`, `read/write_metafields`, `read_online_store_pages` (+ `read_customer_events` اختياري لمصدر الزيارة). ثبّته على متجرك، ثم ضع في الـ ERP: نطاق `xxxx.myshopify.com` (وليس دومين المتجر) + **Client ID** + **Client secret**. الـ ERP يجدد رمز الدخول كل 24 ساعة. يشترط أن يكون التطبيق والمتجر في نفس المؤسسة على Dev Dashboard. (تطبيق قديم برمز `shpat_…` ما زال مدعوماً) |
| **Meta** | رمز **System User** دائم من Business Manager بصلاحيات `ads_management`, `ads_read`, `business_management`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`. الحسابات الإعلانية تختارها من صفحة الإعلانات |
| **التوصيل** | Yalidine (API ID + token) · ZR Express (token + key) · NOEST (api_token + user_guid) |
| **n8n** | روابط Webhook (الأحداث، المنتجات/تيليغرام، التقرير الصباحي، جسر Google Sheets) |
| **Claude** | مفتاح API في الإعدادات ← عام (مشفّر) |
| **سعر الصرف** | 1$ و1€ بالدينار (السوق الموازي) — من زر سعر الصرف في صفحة المالية أو الإعلانات |

**استقبال الطلبيات من n8n أو أي نموذج:** `POST /api/hooks/<slug-المشروع>/orders` مع الترويسة `x-erp-key` (المفتاح من الإعدادات ← عام ← n8n).
الحقول المدعومة: `customer_name, phone, wilaya, commune, address, delivery_type, items[], total, utm_source, utm_campaign, utm_content, landing_url`.

---

## اختبار صفحات الهبوط A/B على نفس الدومين

1. في محرر قالب Shopify أنشئ قوالب منتج إضافية (مثل `product.angle-gift`) أو صفحات هبوط.
2. في الـ ERP: **اختبار الصفحات ← اختبار جديد**: رابط الدخول `/products/thermos` والنسخ مثل
   `/products/thermos?view=angle-gift` · `/pages/thermos-lp` مع النسب.
3. **تثبيت على القالب** (مرة واحدة). إن رفضت Shopify التثبيت التلقائي (يتطلب استثناءً لبعض التطبيقات) يعطيك الـ ERP الكود والسطر لتلصقهما يدوياً في دقيقتين.
4. ضع رابط المنتج العادي في الإعلان. كل زائر جديد يرى نسخة، ويبقى عليها إن عاد، والطلبية تُنسب عبر `utm_content`.

- الإعدادات تُحفظ في metafield المتجر (`erp_toureche.splits`)، فالاختبار يعمل **24/7 دون جهازك**.
- عدّ الزوار اختياري (يحتاج رابطاً عاماً للـ ERP)؛ دونه يحكم الـ ERP بالطلبيات مقارنة بنِسب التوزيع (نموذج Poisson-Gamma).
- سياسة Meta: كل النسخ = نفس المنتج ونفس العرض. لا cloaking (روبوتات Meta توجَّه بنفس التوزيع).

---

## قواعد الإعلانات المطبّقة (حسب Meta)

- تغيير الميزانية بنسبة كبيرة قد يعيد المجموعة إلى **مرحلة التعلم** (Meta Business Help: *Significant edits and the learning phase*). الـ ERP يقترح **+20% كحد أقصى** في كل مرة، ثم الانتظار 3–4 أيام، ويطلب تأكيداً صريحاً لأي تغيير أكبر.
- تعديل الجمهور أو التصميم، إضافة إعلان، تغيير المزايدة، أو الإيقاف 7 أيام فأكثر = تعديل جوهري ← تحذير قبل الحفظ.
- حالة التعلم لكل مجموعة (`learning_stage_info`) ظاهرة في المستكشف.
- الحكم على المنتج = **تكلفة الطلبية المسلّمة** مقابل **حد التعادل** (السعر − التكلفة − التغليف − حصة المرتجعات)، لا مشتريات البيكسل.
- الحملات تُنشأ **متوقفة** للمراجعة؛ التفعيل والميزانيات بكلمة المرور الحساسة؛ الميزانية لا تُخمَّن أبداً.

---

## الأمان · Sécurité

- كلمة مرور دخول + **كلمة مرور حساسة** منفصلة للحذف والأسعار والميزانيات وتفعيل الحملات والإعدادات.
- المفاتيح السرية مشفّرة AES-256-GCM ولا تُعرض بعد حفظها. احفظ نسخة من `data/.secret-key`.
- جلسات httpOnly + SameSite=Strict، حماية CSRF، قفل بعد محاولات خاطئة، سجل نشاط كامل.
- نسخة احتياطية كل ليلة في `data/backups` (آخر 14 يوماً) + نسخة خارج الجهاز في مجلد سحابي عبر `ERP_BACKUP_MIRROR` (انظر أدناه).
- نسيت كلمة المرور؟ `npm run reset-password -- اسم_المستخدم كلمةجديدة123` أو `npm run reset-password -- --sensitive كلمةجديدة123`.

---

## إن تعطّل الجهاز · Si l’ordinateur lâche

الكود محفوظ في GitHub، والبيانات (الطلبيات، الزبائن، الإعدادات) تُنسخ كل ليلة إلى مجلد Google Drive أو OneDrive أو iCloud.

**مرة واحدة الآن:** ثبّت تطبيق Google Drive (أو OneDrive) على الجهاز، ثم أضف إلى ملف `.env`:

```bash
ERP_BACKUP_MIRROR='G:\My Drive\ERP-backups'                                   # Windows (Google Drive)
ERP_BACKUP_MIRROR='~/Library/CloudStorage/GoogleDrive-…/My Drive/ERP-backups'   # macOS
```

أعد التشغيل ثم اضغط **الإعدادات ← النظام ← نسخة احتياطية الآن**: يجب أن تظهر «يعمل». واحفظ محتوى `data/.secret-key` في مدير كلمات المرور.

**على جهاز جديد:**

```bash
git clone https://github.com/ouss-trch/my-profil.git
cd "my-profil/ERP TOURECHE"
npm run setup
npm run restore -- "<مسار آخر ملف toureche-YYYY-MM-DD.db من المجلد السحابي>"
# ضع ملف .secret-key القديم داخل data/ (وإلا أعد إدخال مفاتيح الربط من الإعدادات — الطلبيات والزبائن لا تتأثر)
npm start
```

نفس المستخدمين وكلمات المرور. `restore` يتحقق من الملف ويحفظ القاعدة السابقة قبل الاستبدال.

---

## التطوير · Développement

```bash
npm test                 # اختبارات الخادم (node:test)
node scripts/ui-audit.cjs http://localhost:3600 out.json   # تدقيق الواجهة: التباين، الأسماء، الحقول، التمرير (DEMO_PASSWORD)
npm run dev              # الخادم مع إعادة التشغيل التلقائي
npm run dev:client       # الواجهة على http://localhost:5173 (تمرّر /api إلى 3600)
```

- **الخادم:** Node 22 · Express 5 · SQLite (better-sqlite3) · `server/`
- **الواجهة:** React 19 · Vite · Tailwind · عربي/فرنسي (RTL/LTR) · وضع داكن/فاتح · PWA · `client/`
- **نسخة عرض:** `scripts/demo.sh` ثم `node scripts/record-demo.cjs` ثم `VITE_DEMO=1 npm --prefix client run build` (بيانات تجريبية مسجّلة، الحفظ معطّل)

انظر `NOTICE.md` للتراخيص و`SKILLS.md` للمهارات المستعملة في البناء.

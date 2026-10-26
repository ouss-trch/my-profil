# المهارات (Skills) المستعملة في بناء ERP TOURECHE

اختيرت حسب الفعالية والتقييم على GitHub، وطُبّقت فعلياً في هذا المشروع:

| المهارة | المستودع | كيف طُبّقت هنا |
|---|---|---|
| **Anthropic Skills** (skill-creator, frontend-design, webapp-testing…) | [anthropics/skills](https://github.com/anthropics/skills) — ≈179k ⭐ | بنية المهارة الخاصة بالمشروع (`.claude/skills/ecommerce-erp-builder`)، واختبار الواجهة بمتصفح حقيقي (Playwright) لكل الصفحات |
| **Superpowers** (TDD، التخطيط، التحقق قبل الإعلان) | [obra/superpowers](https://github.com/obra/superpowers) — ≈94k ⭐ | اختبارات `node:test` قبل الاعتماد، إعادة إنتاج كل خطأ قبل إصلاحه (مثل حكم «رابح» بإنفاق صفر)، التحقق قبل كل commit |
| **Marketing Skills** (CRO، صفحات الهبوط، A/B) | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) — ≈19k ⭐ | منطق اختبار الصفحات A/B، تحليل القمع، نصوص الإعلانات متعددة الزوايا |
| **Impeccable** (audit، polish، harden، critique) | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) — Apache-2.0 | منسوخة في `.claude/skills/impeccable`: تدقيق الواجهة (التباين 47→0، أزرار بلا اسم 4→0، حقول بلا عنوان 26→0)، وقائمة الجودة لكل تعديل واجهة |
| **UI/UX Pro Max** | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | نظام الألوان (كحلي + أخضر مائي)، الكثافة، الوضع الداكن/الفاتح، RTL |
| **n8n Skills** | [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) | توافق عقود البيانات مع سير n8n الحالية (الأحداث، المنتجات، التقرير الصباحي، جسر Sheets) |
| **Trail of Bits Skills** (مراجعة الأمان) | [trailofbits/skills](https://github.com/trailofbits/skills) | تشفير الأسرار، كلمة مرور العمليات الحساسة، CSP، فحص Origin، حدود المعدل، عدم رفع أي سر إلى git |

## مهارات التحسين والمراجعة (منسوخة في `.claude/skills/` مع رخصها)

اختيرت بعد بحث على GitHub لتحسين الـ ERP دون تغيير سلوكه: مراجعة، أمان، أداء، اختبار، وتحويل.

| المهارة | المصدر · الرخصة | ما طُبّق منها هنا |
|---|---|---|
| `sentry-security-review` · `find-bugs` · `skill-scanner` | [getsentry/skills](https://github.com/getsentry/skills) · Apache-2.0 | مراجعة أمان قبل فتح الـ ERP على الإنترنت: رمز الإعداد الأول، IP الزائر خلف Traefik، مسارات الصور، تنقية HTML المولّد؛ وفحص المهارات المنسوخة نفسها |
| `sharp-edges` · `supply-chain-risk-auditor` | [trailofbits/skills](https://github.com/trailofbits/skills) · CC-BY-SA-4.0 | إعدادات آمنة افتراضياً (`ERP_TRUST_PROXY`)، وتدقيق المكتبات: ترقية multer و express-rate-limit وتثبيت ip-address على نسخ عمرها أسبوعان على الأقل |
| `react-best-practices` · `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) · MIT | مراجعة أداء React والواجهة (الحقول، الوصولية، RTL) |
| `webapp-testing` | [anthropics/skills](https://github.com/anthropics/skills) · Apache-2.0 | اختبار الصفحات بمتصفح حقيقي (Playwright) |
| `systematic-debugging` · `verification-before-completion` | [obra/superpowers](https://github.com/obra/superpowers) · MIT | السبب الجذري قبل الإصلاح، ولا إعلان «يعمل» قبل تشغيل الاختبار |
| `cro` · `ab-testing` · `offers` · `conversion-tracking` | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) · MIT | صفحات الهبوط واختبارات A/B، العروض، وتتبّع التحويل (Pixel / CAPI) |

التثبيت في Claude Code: `bash scripts/install-skills.sh` — مهارتا المشروع و Impeccable موجودتان مسبقاً في `.claude/skills/` بجذر المستودع.

## مهارة المشروع: `ecommerce-erp-builder`

في جذر المستودع: `.claude/skills/ecommerce-erp-builder/` — تُحمَّل تلقائياً في Claude Code داخل هذا المستودع.
تشرح طريقة بناء ERP/CRM لمتجر الدفع عند الاستلام: أسئلة قصيرة مهمة أولاً، ثم بناء ~80%، ثم التحقق والتسليم.

- `references/journey.md`: **السجل الكامل** — ماذا نريد، أين وصلنا، المراحل وقرار كل مرحلة ودرسها، أكثر الأخطاء كلفة وقاعدة تجنّب كل منها، ودليل إعادة البناء لمتجر آخر.
- `SKILL.md`: سير العمل، القواعد الثابتة (الحكم بالطلبيات المسلّمة، +20% كحد أقصى حسب Meta، الحملات متوقفة، كلمة المرور الحساسة).
- `references/architecture.md`: البنية، الجداول، الأمان، ترتيب البناء.
- `references/integrations.md`: Shopify · Meta · Yalidine/NOEST/ZR · n8n · الذكاء الاصطناعي.
- `references/growth.md`: المؤشرات، المستشار، اختبار الصفحات A/B، ملاحظات مشاريع جديدة (مثل «مكتبة ألواني»).
- `references/pitfalls.md`: المشاكل التي واجهناها وحلولها، قائمة التحقق، طريقة التسليم.

للاستعمال في أي مشروع: `cp -r .claude/skills/ecommerce-erp-builder ~/.claude/skills/` — أو اضغط المجلد (zip) وارفعه في claude.ai ← الإعدادات ← Capabilities ← Skills.

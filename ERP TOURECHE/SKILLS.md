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
| `copywriting` (`801b750`) · `marketing-psychology` (`30f9b9a`) · `ad-creative` (`801b750`) | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) · MIT | أكثر مهارات التسويق تثبيتاً على skills.sh (238K، 167K، 136K): منها صنعة كاتب صفحات الهبوط (الوضوح، الفائدة قبل الخاصية، كلمات الزبون، علامات الكتابة الآلية، الخطاف، قوالب الصور، الإقناع الصادق للدفع عند الاستلام) |
| `find-skills` (`773fb2c`) | [vercel-labs/skills](https://github.com/vercel-labs/skills) · MIT | مهارة Vercel للبحث عن أفضل مهارة لحاجة جديدة (لوحة skills.sh، عدد التثبيتات، سمعة المصدر). أُضيفت إليها قواعد التثبيت الآمن في هذا المستودع: نسخة CLI عمرها أسبوعان على الأقل (`npx skills@1.7.2 find …`)، لا `-g -y`، فحص `skill-scanner`، الرخصة وسطر هنا |

التثبيت في Claude Code: `bash scripts/install-skills.sh` — مهارتا المشروع و Impeccable موجودتان مسبقاً في `.claude/skills/` بجذر المستودع.

## مهارة صفحات الهبوط: `cod-landing-page-builder`

في `.claude/skills/cod-landing-page-builder/`: صنعة باني صفحات الهبوط للدفع عند الاستلام، مستخلصة بطريقة `find-skills` من المهارات أعلاه (ومن `image` و`product-marketing`، والمصادر بنسخها في `references/sources.md`).

- `references/angles.md` · `copy.md` · `visuals.md`: الصنعة بالعربية. **هي نفس الملفات** التي يحمّلها الـ ERP في رسائل النظام (`server/prompts/landing/`)، واختبار `tests/landing-craft.test.js` يفشل إن اختلفت.
- `references/prompt-templates.md`: رسائل نظام وبرومبتات جاهزة لكل خطوة (تحليل المنتج، جواب التاجر إلى ميزة، الكاتب، مخطط الصور، برومبت الصورة) لأي باني: n8n، محادثة، ERP آخر.
- القاعدة الأهم: أجوبة التاجر عن أسئلة الزبائن **خصائص للمنتج** (المواصفات، المميزات، الصور الوصفية، الفوائد)، لا أسئلة شائعة.

## المهارات في حسابك على Claude (لكل المشاريع)

مهارات المستودع تعمل في Claude Code داخل هذا المستودع فقط. لتتبعك في كل مشروع ومحادثة على claude.ai وتطبيق Claude:

1. `bash scripts/pack-skills.sh` ← ملف ZIP لكل مهارة في `dist-skills/` (لا يُرفع إلى GitHub).
2. claude.ai ← **Customize ← Skills** ([claude.ai/customize/skills](https://claude.ai/customize/skills)) ← «+» ← «Create skill» ← «Upload a skill»، وارفع كل ZIP مرة واحدة: `cod-landing-page-builder`، `ecommerce-erp-builder`، `find-skills`، `copywriting`، `marketing-psychology`، `ad-creative`.
3. تظهر بعدها في كل جلسة باسم `anthropic-skills:<الاسم>`. بعد تعديل مهارة: أعد الحزم وارفع الـ ZIP الجديد مكان القديم.

## مهارة المشروع: `ecommerce-erp-builder`

في جذر المستودع: `.claude/skills/ecommerce-erp-builder/` — تُحمَّل تلقائياً في Claude Code داخل هذا المستودع.
تشرح طريقة بناء ERP/CRM لمتجر الدفع عند الاستلام: أسئلة قصيرة مهمة أولاً، ثم بناء ~80%، ثم التحقق والتسليم.

- `references/journey.md`: **السجل الكامل** — ماذا نريد، أين وصلنا، المراحل وقرار كل مرحلة ودرسها، أكثر الأخطاء كلفة وقاعدة تجنّب كل منها، ودليل إعادة البناء لمتجر آخر.
- `SKILL.md`: سير العمل، القواعد الثابتة (الحكم بالطلبيات المسلّمة، +20% كحد أقصى حسب Meta، الحملات متوقفة، كلمة المرور الحساسة).
- `references/architecture.md`: البنية، الجداول، الأمان، ترتيب البناء.
- `references/integrations.md`: Shopify · Meta · Yalidine/NOEST/ZR · n8n · الذكاء الاصطناعي.
- `references/growth.md`: المؤشرات، المستشار، اختبار الصفحات A/B، ملاحظات مشاريع جديدة (مثل «مكتبة ألواني»).
- `references/pitfalls.md`: المشاكل التي واجهناها وحلولها، قائمة التحقق، طريقة التسليم.

للاستعمال في أي مشروع: `cp -r .claude/skills/ecommerce-erp-builder ~/.claude/skills/` — أو `bash scripts/pack-skills.sh ecommerce-erp-builder` وارفع الـ ZIP في claude.ai ← Customize ← Skills (القسم أعلاه).

# المهارات (Skills) المستعملة في بناء ERP TOURECHE

اختيرت حسب الفعالية والتقييم على GitHub، وطُبّقت فعلياً في هذا المشروع:

| المهارة | المستودع | كيف طُبّقت هنا |
|---|---|---|
| **Anthropic Skills** (skill-creator, frontend-design, webapp-testing…) | [anthropics/skills](https://github.com/anthropics/skills) — ≈179k ⭐ | بنية المهارة الخاصة بالمشروع (`.claude/skills/ecommerce-erp-builder`)، واختبار الواجهة بمتصفح حقيقي (Playwright) لكل الصفحات |
| **Superpowers** (TDD، التخطيط، التحقق قبل الإعلان) | [obra/superpowers](https://github.com/obra/superpowers) — ≈94k ⭐ | اختبارات `node:test` قبل الاعتماد، إعادة إنتاج كل خطأ قبل إصلاحه (مثل حكم «رابح» بإنفاق صفر)، التحقق قبل كل commit |
| **Marketing Skills** (CRO، صفحات الهبوط، A/B) | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) — ≈19k ⭐ | منطق اختبار الصفحات A/B، تحليل القمع، نصوص الإعلانات متعددة الزوايا |
| **UI/UX Pro Max** | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | نظام الألوان (كحلي + أخضر مائي)، الكثافة، الوضع الداكن/الفاتح، RTL |
| **n8n Skills** | [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) | توافق عقود البيانات مع سير n8n الحالية (الأحداث، المنتجات، التقرير الصباحي، جسر Sheets) |
| **Trail of Bits Skills** (مراجعة الأمان) | [trailofbits/skills](https://github.com/trailofbits/skills) | تشفير الأسرار، كلمة مرور العمليات الحساسة، CSP، فحص Origin، حدود المعدل، عدم رفع أي سر إلى git |

التثبيت في Claude Code: `bash scripts/install-skills.sh`

## مهارة المشروع: `ecommerce-erp-builder`

في جذر المستودع: `.claude/skills/ecommerce-erp-builder/` — تُحمَّل تلقائياً في Claude Code داخل هذا المستودع.
تشرح طريقة بناء ERP/CRM لمتجر الدفع عند الاستلام: أسئلة قصيرة مهمة أولاً، ثم بناء ~80%، ثم التحقق والتسليم.

- `SKILL.md`: سير العمل، القواعد الثابتة (الحكم بالطلبيات المسلّمة، +20% كحد أقصى حسب Meta، الحملات متوقفة، كلمة المرور الحساسة).
- `references/architecture.md`: البنية، الجداول، الأمان، ترتيب البناء.
- `references/integrations.md`: Shopify · Meta · Yalidine/NOEST/ZR · n8n · الذكاء الاصطناعي.
- `references/growth.md`: المؤشرات، المستشار، اختبار الصفحات A/B، ملاحظات مشاريع جديدة (مثل «مكتبة ألواني»).
- `references/pitfalls.md`: المشاكل التي واجهناها وحلولها، قائمة التحقق، طريقة التسليم.

للاستعمال في أي مشروع: `cp -r .claude/skills/ecommerce-erp-builder ~/.claude/skills/` — أو اضغط المجلد (zip) وارفعه في claude.ai ← الإعدادات ← Capabilities ← Skills.

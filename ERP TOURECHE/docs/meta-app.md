# تطبيق Meta جديد وربطه بالـ ERP (الصفحات، الحساب الإعلاني، الـ BM، البيكسل)

طريقة عملية في 20 دقيقة، حسب وثائق Meta (Marketing API Use Cases · System Users: Install Apps and Generate Tokens · Conversions API Get Started).
الفكرة: **تطبيق واحد منشور + مستخدم نظام واحد + رمز لا ينتهي**، والـ ERP يفحص كل شيء ويقول لك ما ينقص بالضبط.
أسماء الأزرار أدناه كما تظهر في Meta بالفرنسية.

> **قبل حذف أي شيء في Meta:** حذف مستخدم نظام يُبطل كل رموزه فوراً (الـ ERP، n8n، أي سير).
> لا تحذف **«Conversions API System User»**: رمز n8n الذي يرسل Purchase يعمل (تحقّقنا منه في 28/10 بعد حذف المستخدم القديم «Toureche ERP»).

## 1) التطبيق

1. **إن كان عندك تطبيق جديد**: Paramètres de l’entreprise ← Comptes ← **Applications**. إن ظهر فيها فهو مربوط بالـ BM، انتقل إلى الخطوة 5.
2. **إن لم يكن**: في نفس الصفحة **Ajouter ← Créer un nouvel identifiant d’app** (يُنشأ مربوطاً بالـ BM مباشرة)، أو من developers.facebook.com ← Créer une app.
3. الاسم مثل `Toureche ERP`. حالة الاستعمال: **Créer et gérer des publicités avec l’API Marketing**.
   تضيف: `ads_management`، `ads_read`، `business_management`، `pages_read_engagement`، `pages_show_list`.
   - للنشر على الصفحة وإنستغرام من الـ ERP: أضف حالة الاستعمال الخاصة بإدارة الصفحة وإنستغرام (`pages_manage_posts`، `instagram_basic`، `instagram_content_publish`).
   - للكتالوج: `catalog_management`.
4. **Portefeuille business**: اختر الـ BM الذي يملك الحساب الإعلاني والبيكسل (SOU9NA: ‏BM 1 = ‏142572800037749).
5. **انشر التطبيق (Live)، وهذا ضروري:** التطبيق الجديد في «وضع التطوير»، فيقرأ البيانات لكن Meta **ترفض إنشاء الإعلانات** منه (الخطأ 1885183: «Ads creative post was created by an app that is in development mode»).
   developers.facebook.com ← التطبيق ← **Paramètres de l’app ← Général**:
   - URL de la politique de confidentialité: `https://souqnna.com/policies/privacy-policy`
   - Catégorie: Shopping (أو Business)
   - Enregistrer.

   ثم في القائمة **Publier** (Publication): من «Non publiée» إلى منشورة. إن طلبت Meta حقلاً آخر فستظهره بالأحمر.
   هذا ليس App Review: لا تحتاجه، لأن التطبيق يصل فقط إلى أصول تملكها أنت. إن طلبت Meta **التحقق من النشاط التجاري**، فأكمله من «Centre de sécurité».

## 2) مستخدم النظام: أسند له كل عنصر

**إنشاؤه:** Paramètres de l’entreprise ← Utilisateurs ← **Utilisateurs système** ← Ajouter.
- الاسم مثل `Erp_souqnna`.
- الدور **Employé (Employee)**: يرى فقط ما تسنده له، وهو أكثر أماناً من Admin.

**الإسناد:** نفس الطريقة لكل عنصر، كما فعلت مع الصفحة. افتح العنصر من مكانه ← **Attribuer des personnes** ← **Utilisateurs système** ← اختر `Erp_souqnna` ← فعّل **Contrôle total** ← **Attribuer**.

| العنصر | مكانه في Paramètres de l’entreprise | اختر |
|---|---|---|
| أ. الحساب الإعلاني | Comptes ← **Comptes publicitaires** | **ADCompte 3** (‏1021341893008834)، وكل حساب تُطلق منه حملات SOU9NA |
| ب. البيكسل | Sources de données ← **Ensembles de données** | **SOU9NA** (‏2111277745999858) فقط |
| ج. التطبيق | Comptes ← **Applications** | تطبيقك الجديد |
| د. الصفحة | Comptes ← **Pages** | **Sou9na** |
| هـ. إنستغرام | Comptes ← **Comptes Instagram** | **sou9nna_**. في لوحة مستخدم النظام، إن ظهر «Aucun élément affecté» بجانبه: **Gérer** ← Contrôle total |

> **انتبه في (ب):** في الـ BM مصدران أُنشئا في 28/10 بلا أي حدث: **«Souqnna»** (09:43) و**«Erp.system»** (10:03).
> لا تختر أياً منهما كبيكسل. البيكسل الذي يرسل إليه المتجر وn8n هو **SOU9NA** وحده.
> إن كان «Erp.system» اسم تطبيقك، فظهوره هناك طبيعي: Meta تعرض التطبيقات بين مصادر البيانات.

SOU9NA مربوط أصلاً بـ ADCompte 3، وsou9nna_ مربوط بـ ADCompte 3 (تحققنا منهما في 28/10): لا حاجة لـ «Éléments connectés».

**الرمز:**
1. Utilisateurs système ← `Erp_souqnna` ← **Générer un token**.
2. اختر التطبيق.
3. Expiration: **Jamais**.
4. علّم الصلاحيات:
   - الأساسية: `ads_management`، `ads_read`، `business_management`، `pages_show_list`، `pages_read_engagement`.
   - للنشر والكتالوج: `pages_manage_ads`، `pages_manage_posts`، `instagram_basic`، `instagram_content_publish`، `catalog_management`.
5. **Générer un token** ← انسخه، فهو يظهر مرة واحدة.

## 3) في الـ ERP

1. الإعدادات ← تكاملات المشروع ← بطاقة Meta: الصق الرمز في «رمز System User» ← حفظ (كلمة المرور الحساسة).
2. **«اكتشاف من Meta»**: اختر الـ BM والحسابات الإعلانية والبيكسل والصفحة بالأسماء ← حفظ.
   البيكسل الذي لم يصله حدث يظهر «لم يُستعمل»، ويُختار تلقائياً الذي وصله آخر حدث (SOU9NA).
3. **«اختبار»**: قائمة واضحة، كل سطر ✓ أو ✗ مع ما يجب فعله. الأسطر:
   - التطبيق
   - الرمز صالح، ولا ينتهي
   - الصلاحيات الناقصة ولماذا تلزم
   - كل حساب إعلاني، ونشاطه
   - البيكسل: آخر حدث، وأحداث 24 ساعة
   - الصفحة
4. **تجربة إرسال الأحداث (CAPI)**:
   1. Events Manager ← SOU9NA ← **Tester les événements** ← انسخ الرمز (مثل `TEST12345`).
   2. ضعه في «رمز اختبار الأحداث» ← حفظ ← «اختبار».
   3. يظهر حدث `OrderConfirmed` تجريبي في «Tester les événements».
   4. **امسح الرمز بعدها**، وإلا ذهبت أحداث الـ ERP كلها إلى التجربة.
5. فعّل «إرسال طلبية أُكّدت» و«إرسال طلبية سُلّمت».

## 4) رمز n8n (سير COD يرسل Purchase)

رمز n8n الحالي يعمل: تحققنا في 28/10 بطلب قراءة فقط. لا تغيّره.
إن احتجت رمزاً جديداً يوماً، فالأبسط والأضيق صلاحية:
- Events Manager ← SOU9NA ← Paramètres ← API Conversions ← **Générer un token d’accès**. يظهر الزر لمن له صلاحية مطوّر على الـ BM.
- ضعه في n8n: Credentials ← `access_token` (الحقل Value). تستعمله عقدة «Meta Conversions API» في سير COD.

هذا الرمز يرسل الأحداث فقط.

## 5) الدومين والإعلان الرئيسي

- Paramètres de l’entreprise ← Sécurité de la marque ← **Domaines**: أضف `souqnna.com` وتحقق منه (وسم meta في القالب، أو سجل TXT في نطاقات Shopify).
- رابط الإعلان الرئيسي هو **صفحة المنتج نفسها** (`https://souqnna.com/products/<handle>`)، لا رابط تحويل (`/go/…`) ولا رابط اختبار (`?erp_t=`).
- الـ ERP يفحص الرابط قبل الإطلاق: يفتح، البيكسل، نموذج الطلب، المخزون، ولا تحويل.
- يضع التتبّع في **Paramètres d’URL** لا داخل الرابط:
  `utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`.
  تُكتب عند الإنشاء، لأن تغييرها بعد النشر يعيد المجموعة إلى مرحلة التعلّم.

## 6) إن لم يعمل شيء

| ما تراه | السبب | الحل |
|---|---|---|
| «Aucune autorisation disponible» عند إنشاء الرمز | التطبيق غير مُسند لمستخدم النظام | 2-ج |
| التطبيق لا يظهر في «Générer un token» | التطبيق ليس في هذا الـ BM | 1-1 و1-2، ثم 2-ج |
| «Jamais» غير موجودة | Meta تفرض على بعض النشاطات رموزاً تنتهي | اختر 60 يوماً وجدّده قبل انتهائه. «اختبار» يُظهر أنه ينتهي |
| الـ ERP: «رمز Meta لم يعد صالحاً» | حُذف مستخدم النظام، أو أُلغي الرمز، أو انتهى | رمز جديد (القسم 2) ← بطاقة Meta |
| الـ ERP: «تطبيق Meta غير منشور» | وضع التطوير (1885183) | 1-5 |
| «اختبار»: الحساب الإعلاني ✗ «لا وصول» | الحساب غير مُسند | 2-أ |
| «اختبار»: البيكسل ✗ | SOU9NA غير مُسند | 2-ب |
| «اختبار»: الصفحة ✗ | الصفحة غير مُسندة | 2-د |

## 7) تنظيف بعد الانتقال

- احذف التطبيقات ومستخدمي النظام القديمة غير المستعملة، أو ألغِ رموزها (Utilisateurs système ← Révoquer les tokens).
  قبل الحذف، تأكد أن لا شيء يستعمل رموزها: الـ ERP، n8n، وأي سير.
- حدّث كل مكان كان فيه الرمز القديم: الـ ERP (بطاقة Meta)، وأي سير يكتب رمزاً **نصاً داخل العقدة** (انقله إلى Credentials).
- مصادر البيانات الفارغة («Souqnna»، «Erp.system») لا تُحذف من Meta. اتركها دون استعمال.
- لا ترسل رمزاً في محادثة أو رسالة. الـ ERP يحفظه مشفّراً ولا يعرضه.

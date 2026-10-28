# تطبيق Meta جديد وربطه بالـ ERP (الصفحات، الحساب الإعلاني، الـ BM، البيكسل)

طريقة عملية في 20 دقيقة، حسب وثائق Meta (Marketing API Use Cases · System Users: Install Apps and Generate Tokens · Conversions API Get Started).
الفكرة: **تطبيق واحد منشور + مستخدم نظام واحد + رمز لا ينتهي**، والـ ERP يفحص كل شيء ويقول لك ما ينقص بالضبط.
أسماء الأزرار أدناه كما تظهر في Meta بالفرنسية.

> **قبل حذف أي شيء في Meta:** حذف تطبيق أو مستخدم نظام يُبطل فوراً كل الرموز المبنية عليه (الـ ERP، n8n، أي سير).
> في 28/10 حُذف التطبيق القديم «Toureche ERP»، وبقي مستخدم النظام الذي يحمل الاسم نفسه. رمز n8n الذي يرسل Purchase ما زال يعمل (تحققنا منه بعد الحذف).
> لا تحذف **«Conversions API System User»** ولا **«Toureche ERP»** قبل أمرين: أن يعمل الرمز الجديد في الـ ERP، وأن تمرّ طلبية في n8n بنجاح.

## 1) التطبيق

1. **إن كان عندك تطبيق جديد**: Paramètres de l’entreprise ← Comptes ← **Applications**. إن ظهر فيها فهو مربوط بالـ BM، انتقل إلى الخطوة 5.
   تطبيق SOU9NA الجديد: **Erp_souqnna** (‏4534522960162075، Appartient à: BM 1). يحمل اسم مستخدم النظام نفسه، وهذا لا يضرّ.
2. **إن لم يظهر**: في نفس الصفحة **Ajouter**، ثم:
   - **Connecter un identifiant d’app**: إن أنشأته من developers.facebook.com دون اختيار الـ BM. ضع معرّفه (Paramètres de l’app ← Général) ← Ajouter l’app.
   - أو **Créer un nouvel identifiant d’app**: تطبيق جديد مربوط بالـ BM مباشرة.
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
  إن لم يقبل التطبيقُ أو الحسابُ الإعلاني مستخدمَ النظام وهو Employee (هذا ما وجده صاحب SOU9NA في 28/10)، فاجعله **Admin** من زر «…» بجانب «Révoquer les tokens»، ثم أكمل الإسناد.
  رمز مستخدم Admin أقوى: يدير الـ BM كله. لا تضعه إلا في الـ ERP، فهو يحفظه مشفّراً.

**الإسناد:** نفس الطريقة لكل عنصر، كما فعلت مع الصفحة. افتح العنصر من مكانه ← **Affecter des personnes** (أو «Attribuer des personnes») ← اختر `Erp_souqnna`، وإن ظهر قسمان فهو في Utilisateurs système ← فعّل **Contrôle total** ← **Affecter**.

| العنصر | مكانه في Paramètres de l’entreprise | اختر |
|---|---|---|
| أ. الحساب الإعلاني | Comptes ← **Comptes publicitaires** | **ADCompte 3** (‏1021341893008834)، وكل حساب تُطلق منه حملات SOU9NA |
| ب. البيكسل | Sources de données ← **Ensembles de données** | **SOU9NA** (‏2111277745999858) فقط |
| ج. التطبيق | Comptes ← **Applications** | **Erp_souqnna** (‏4534522960162075). Contrôle total = **Gérer l’app** |
| د. الصفحة | Comptes ← **Pages** | **Sou9na** |
| هـ. إنستغرام | Comptes ← **Comptes Instagram** | **sou9nna_**. في لوحة مستخدم النظام، إن ظهر «Aucun élément affecté» بجانبه: **Gérer** ← Contrôle total |

> **انتبه في (ب):** في الـ BM مصدران أُنشئا في 28/10 بلا أي حدث، فلا تختر أياً منهما كبيكسل:
> - **«Souqnna»** (09:43): بيكسل فارغ.
> - **«Erp.system»** (10:03): مصدر فارغ آخر، وليس التطبيق. التطبيق هو «Erp_souqnna» في Applications.
>
> البيكسل الذي يرسل إليه المتجر وn8n هو **SOU9NA** وحده.
>
> إن رفضت Meta الإسناد («Impossible d’affecter…» أو «…d’attribuer…»): أعد إدخال كلمة السر أو رمز المصادقة الثنائية حين تطلبه. وتأكد من بريدك في Informations sur le portefeuille ← Mes informations.

SOU9NA مربوط أصلاً بـ ADCompte 3، وsou9nna_ مربوط بـ ADCompte 3 (تحققنا منهما في 28/10): لا حاجة لـ «Éléments connectés».

**الرمز:**
1. Utilisateurs système ← `Erp_souqnna` ← **Générer un token**.
2. اختر التطبيق.
3. Expiration: **Jamais**.
4. علّم الصلاحيات:
   - الأساسية: `ads_management`، `ads_read`، `business_management`، `pages_show_list`، `pages_read_engagement`.
   - للنشر والكتالوج: `pages_manage_ads`، `pages_manage_posts`، `instagram_basic`، `instagram_content_publish`، `catalog_management`.
5. **Générer un token** ← انسخه، فهو يظهر مرة واحدة.

**إن طلبت Meta «Vérifier le compte» قبل الرمز ولم تصل الرسالة** (SMS من 6 أرقام إلى رقمك الشخصي):
هذه مشكلة عند Meta نفسها، لا علاقة لها بالتطبيق ولا بالإسناد، فلا تعِد إنشاء التطبيق.
وجدنا في 28/10 حالتين مطابقتين في مجتمع مطوّري Meta (الأرجنتين والبيرو، مفتوحتان منذ منتصف أكتوبر بلا حل، وردّ دعم Meta بأنه لا طريقة بديلة)، ثم حالة صاحب SOU9NA في الجزائر.
المتجر وn8n والبيكسل لا يتأثرون: الذي يتوقف فقط هو ربط الـ ERP بـ Meta (إطلاق الحملات، قراءة الإنفاق، وأحداث الـ ERP).
1. **أوقف المحاولات.** كثرة طلب الرمز قد تحجب Meta الرسائل مؤقتاً (احتمال لم نتحقق منه).
2. **أضف طريقة أخرى لاستقبال الرمز في حسابك الشخصي:** Paramètres et confidentialité ← Paramètres ← Espace Comptes ← Mot de passe et sécurité ← Authentification à deux facteurs ← اختر حسابك ← **Application d’authentification** (Google أو Microsoft Authenticator، لا تعتمد على شبكة الهاتف) أو **WhatsApp** إن ظهر.
   إن لم يظهر هذا المسار: facebook.com/settings?tab=security ← Utiliser l’authentification à deux facteurs ← Modifier.
   **لا تحذف الرقم**، واحفظ **Codes de récupération**.
3. **ارجع إلى Générer un token.** افتح تطبيق فيسبوك على هاتفك قبل الضغط (قد يصلك إشعار موافقة)، وإن ظهرت «Essayer une autre méthode» أو «Autres options» فاختر التطبيق أو WhatsApp.
   هذه الطرق موثّقة عند Meta لتسجيل الدخول؛ لم نتحقق أن شاشة الرمز تعرضها، وقد تعرض SMS فقط.
4. **شخص موثوق (أو حساب فيسبوك ثانٍ لك برقم آخر) مديراً:** Utilisateurs ← Personnes ← Ajouter ← بريده ← **Contrôle total**. يقبل الدعوة، ويضغط هو **Générer un token** (تصل الرسالة إلى هاتفه)، ويرسل لك الرمز مرة واحدة في رسالة خاصة. تلصقه في الـ ERP وتمسح الرسالة، ثم تزيله من الـ BM.
5. **دعم Meta:** Business Support Home ← Chat. النص (بلا رموز ولا بيانات شخصية):
   ```
   System user token generation blocked: the "Verify account" SMS never arrives (Algeria).
   Flow: Business settings > Users > System users > [system user] > Generate token > "Account
   verification required" > Verify account > 6-digit SMS to my security phone number.
   The SMS never arrives (20+ attempts), and no notification either. The dialog offers no other
   method. Please give me a supported way to complete this verification (authenticator app,
   WhatsApp, or a review by your team). Same issue as developers.facebook.com/community/threads/1079377121557456
   and /2200352837176665 (both unresolved).
   ```

**الحل المؤقت إن لم تنجح كل الطرق: رمز مستخدم صالح نحو شهرين** (نفّذه صاحب SOU9NA في 28/10 وأعطته Meta رمزاً لشهرين، وليس رمزاً لا ينتهي).
1. developers.facebook.com/tools/explorer ← التطبيق **Erp_souqnna** ← **User Token** (الرمز لمستخدم).
2. أضف الصلاحيات: `ads_management`، `ads_read`، `business_management`، `pages_show_list`، `pages_read_engagement` (+ `pages_manage_ads`، `instagram_basic` عند الحاجة) ← **Generate Access Token**. وافق، واختر الصفحة وحساباتك الإعلانية حين تُسأل.
3. انسخ الرمز ← developers.facebook.com/tools/debug/accesstoken ← الصقه ← **Debug** ← **Extend Access Token** ← انسخ الرمز الجديد.
4. الـ ERP: الإعدادات ← بطاقة Meta ← الصقه ← حفظ ← «اكتشاف من Meta» ← «اختبار». سطر «صلاحية الرمز» يعرض التاريخ والأيام المتبقية.
5. **جدّده قبل التاريخ بـ 10 أيام على الأقل** بتكرار 1-3 (ضع تذكيراً في هاتفك). وحين تنجح «Vérifier le compte» أنشئ رمز System User بمدة «Jamais» وبدّله.
6. **الأمان:** هذا الرمز يعمل بصلاحيات حسابك الشخصي في كل ما يملكه من حسابات إعلانية وصفحات. لا ترسله لأحد ولا تصوّر شاشته. إن ظننت أنه تسرّب فغيّر كلمة سر فيسبوك وولّد غيره.
7. إن ظهر في الـ ERP خطأ «Require App Secret»: التطبيق ← Paramètres de l’app ← Avancé ← «Require App Secret» ← Non.
8. نشر التطبيق (Live) ما زال لازماً قبل أول إطلاق حملة من الـ ERP (القسم 1، الخطوة 5).

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
| لا يظهر Erp_souqnna عند إسناد التطبيق أو الحساب الإعلاني | مستخدم النظام بدور Employee | «…» ← اجعله Admin، ثم أسند (القسم 2) |
| لا يقبل Erp_souqnna الحساب الإعلاني حتى وهو Admin | | مستخدم النظام القديم «Toureche ERP» ما زال يملك ADCompte 3 والصفحة والبيكسل وإنستغرام: أسند له التطبيق الجديد (2-ج) وأنشئ الرمز منه |
| «Jamais» غير موجودة | Meta تفرض على بعض النشاطات رموزاً تنتهي | اختر 60 يوماً وجدّده قبل انتهائه. «اختبار» يُظهر أنه ينتهي |
| الـ ERP: «تطبيق Meta يشترط Require App Secret» | إعداد في التطبيق | التطبيق ← Paramètres de l’app ← Avancé ← «Require App Secret» ← Non |
| «اختبار»: «صلاحية الرمز» ينتهي في تاريخ | رمز مستخدم (60 يوماً) لا System User | جدّده قبل التاريخ (الحل المؤقت في القسم 2) |
| «Vérifier le compte» عند Générer un token، والرسالة لا تصل | خطوة أمان عند Meta (مشكلة معروفة منذ أكتوبر 2026) | القسم 2: «إن طلبت Meta…» |
| الـ ERP: «رمز Meta لم يعد صالحاً» | حُذف مستخدم النظام، أو أُلغي الرمز، أو انتهى | رمز جديد (القسم 2) ← بطاقة Meta |
| الـ ERP: «تطبيق Meta غير منشور» | وضع التطوير (1885183) | 1-5 |
| «اختبار»: الحساب الإعلاني ✗ «لا وصول» | الحساب غير مُسند | 2-أ |
| «اختبار»: البيكسل ✗ | SOU9NA غير مُسند | 2-ب |
| «اختبار»: الصفحة ✗ | الصفحة غير مُسندة | 2-د |

## 7) تنظيف بعد الانتقال

- احذف التطبيقات ومستخدمي النظام القديمة غير المستعملة، أو ألغِ رموزها (Utilisateurs système ← Révoquer les tokens).
  قبل الحذف، تأكد أن لا شيء يستعمل رموزها: الـ ERP، n8n، وأي سير.
  «Toureche ERP» (مستخدم النظام القديم) يُحذف بعد أمرين: أن يعمل الرمز الجديد في الـ ERP، وأن تمرّ طلبية في n8n بنجاح.
- حدّث كل مكان كان فيه الرمز القديم: الـ ERP (بطاقة Meta)، وأي سير يكتب رمزاً **نصاً داخل العقدة** (انقله إلى Credentials).
- مصادر البيانات الفارغة («Souqnna»، «Erp.system») لا تُحذف من Meta. اتركها دون استعمال.
- لا ترسل رمزاً في محادثة أو رسالة. الـ ERP يحفظه مشفّراً ولا يعرضه.

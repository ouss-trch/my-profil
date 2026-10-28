# تطبيق Meta جديد وربطه بالـ ERP (الصفحات، الحساب الإعلاني، الـ BM، البيكسل)

طريقة عملية في 20 دقيقة، حسب وثائق Meta (Marketing API Use Cases · System User Access Tokens · Conversions API Get Started).
الفكرة: **تطبيق واحد + مستخدم نظام واحد + رمز لا ينتهي**، والـ ERP يفحص كل شيء ويقول لك ما ينقص بالضبط.

## 1) التطبيق (developers.facebook.com)

1. My Apps ← **Create app** ← اسم مثل `Toureche ERP` وبريدك.
2. حالة الاستعمال (Use case): **Create & manage ads with Marketing API**.
   تضيف تلقائياً: `ads_management`، `ads_read`، `business_management`، `pages_read_engagement`، `pages_show_list`.
   - للنشر على الصفحة وإنستغرام من الـ ERP: أضف أيضاً حالة الاستعمال الخاصة بإدارة الصفحة وإنستغرام (`pages_manage_posts`، `instagram_basic`، `instagram_content_publish`).
   - للكتالوج: `catalog_management` (اختياري في نفس حالة الإعلانات).
3. **Business portfolio**: اختر الـ BM الذي يملك الحساب الإعلاني والبيكسل (SOU9NA: البيكسل في الـ BM ‏142572800037749).
4. لا حاجة لـ App Review ولا للنشر (Publish): التطبيق يصل إلى أصول تملكها أنت. (Meta: «App Review فقط إن كان تطبيقك يصل إلى بيانات لا تملكها».)
   إن طلبت Meta **التحقق من النشاط التجاري** (Business verification) فأكمله من «مركز الأمان».

## 2) مستخدم النظام والرمز (Business settings ← Users ← System users)

1. **+Add** ← الاسم `toureche-erp` ← الدور **Employee** (أكثر أماناً من Admin: يرى فقط ما تسنده له).
2. اضغط اسمه ← **Assign assets**:
   - **Apps**: تطبيق `Toureche ERP` ← Manage app (Full control).
   - **Ad accounts**: الحسابات التي تُطلق منها حملات SOU9NA ← Manage ad account.
   - **Pages**: صفحة المتجر ← Full control (أو Content + Ads + Insights).
   - **Datasets / Pixels**: بيكسل **SOU9NA** ‏2111277745999858 ← Manage.
   - (Catalogs إن كنت تستعمل الكتالوج.)
3. **Generate token** ← اختر التطبيق ← المدة **Never** ← علّم الصلاحيات أعلاه ← انسخ الرمز (يظهر مرة واحدة).

## 3) في الـ ERP

1. الإعدادات ← تكاملات المشروع ← بطاقة Meta: الصق الرمز في «رمز System User» ← حفظ (كلمة المرور الحساسة).
2. **«اكتشاف من Meta»**: اختر الـ BM، الحسابات الإعلانية، البيكسل (يظهر آخر حدث وصله) والصفحة بالأسماء ← حفظ.
3. **«اختبار»**: قائمة واضحة، كل سطر ✓ أو ✗ مع ما يجب فعله:
   التطبيق · الرمز صالح · لا ينتهي · الصلاحيات الناقصة ولماذا تلزم · كل حساب إعلاني (نشط؟) · البيكسل (آخر حدث، أحداث 24 ساعة) · الصفحة.
4. **تجربة إرسال الأحداث (CAPI)**: Events Manager ← البيكسل ← **Test events** ← انسخ الرمز (مثل `TEST12345`) ← ضعه في «رمز اختبار الأحداث» ← حفظ ← «اختبار».
   يظهر حدث `OrderConfirmed` تجريبي في Test events. **امسح الرمز بعدها** (وإلا ذهبت أحداث الـ ERP كلها إلى التجربة).
5. فعّل «إرسال طلبية أُكّدت» و«إرسال طلبية سُلّمت».

## 4) رمز n8n (سير COD يرسل Purchase)

الأبسط والأضيق صلاحية: Events Manager ← البيكسل ← Settings ← Conversions API ← **Generate access token**
(يظهر لمن له صلاحية مطوّر على الـ BM). ضعه في n8n: Credentials ← بيانات «Meta Conversions API» (حقل `access_token`).
هذا الرمز يرسل الأحداث ويقرأ جودة البيكسل فقط.

## 5) الدومين والإعلان الرئيسي

- Business settings ← Brand safety ← **Domains** ← أضف `souqnna.com` وتحقق منه (وسم meta في القالب أو سجل TXT في نطاقات Shopify).
- رابط الإعلان الرئيسي = **صفحة المنتج نفسها** (`https://souqnna.com/products/<handle>`)، لا رابط تحويل (`/go/…`) ولا رابط اختبار (`?erp_t=`):
  الـ ERP يفحصه قبل الإطلاق (يفتح، البيكسل، نموذج الطلب، المخزون، لا تحويل) ويضع التتبّع في **URL parameters** لا داخل الرابط:
  `utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`.
  (تغييرها بعد النشر يعيد المجموعة إلى مرحلة التعلّم: تُكتب عند الإنشاء.)

## 6) تنظيف بعد الانتقال

- احذف مستخدمي النظام والتطبيقات القديمة غير المستعملة، أو ألغِ رموزها (Business settings ← System users ← Revoke tokens).
- حدّث كل مكان كان فيه الرمز القديم: الـ ERP (بطاقة Meta)، n8n (بيانات Meta)، وأي سير يكتب رمزاً **نصاً داخل العقدة** (انقله إلى Credentials).
- لا ترسل رمزاً في محادثة أو رسالة؛ الـ ERP يحفظه مشفّراً ولا يعرضه.

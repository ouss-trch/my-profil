# نقل الـ VPS (n8n + ERP في Docker) إلى سيرفر جديد

سكريبتان:

- `backup.sh`: يُشغَّل على **السيرفر القديم**. ينسخ كل شيء في ملف واحد: مفتاح تشفير n8n، الـ workflows والـ credentials، كل volumes الـ Docker، مجلدات الـ compose مع ملفات `.env`، المجلدات المربوطة (bind mounts)، والصور المبنية على السيرفر.
- `restore.sh`: يُشغَّل على **السيرفر الجديد**. يعيد كل شيء إلى مكانه بنفس النسخ ويشغّل المشاريع.

> ⚠️ ملف النسخة يحتوي على مفتاح التشفير وكل الأسرار. لا ترفعه أبداً إلى GitHub (هذا المستودع عام).

## 1. اليوم: نسخة احتياطية فورية (بدون إيقاف الخدمات)

من hPanel ← VPS ← **Console Web** (أو `ssh root@IP`):

```bash
curl -fsSLO https://raw.githubusercontent.com/ouss-trch/my-profil/refs/heads/claude/vps-migration-kvm2-kvm1-ciiw6o/vps-migration/backup.sh
bash backup.sh
```

كل حاوية تتوقف بضع ثوانٍ فقط أثناء نسخ بياناتها. في النهاية يطبع السكريبت مسار الملف، مثلاً
`/var/backups/vps-migration/vps-backup-20261028-140000.tar`.

**انسخه إلى حاسوبك** (من Terminal على الـ Mac):

```bash
scp root@IP_القديم:/var/backups/vps-migration/vps-backup-*.tar* ~/Desktop/
```

**احفظ مفتاح تشفير n8n** في مدير كلمات المرور (بدونه لا يمكن فك تشفير أي credential):

```bash
tar -xOf /var/backups/vps-migration/vps-backup-*.tar --wildcards '*/encryption-key.txt'
```

## 2. يوم الانتقال

1. **اشترِ الـ VPS الجديد** واختر نظام **Ubuntu 24.04** (أو Ubuntu 24.04 with Docker).
   لا تختر قالب n8n: سينشئ n8n جديداً بمفتاح تشفير مختلف، و`restore.sh` سيرفض العمل فوقه.
2. **قبلها بساعات**: في إدارة الـ DNS اخفض الـ TTL لسجلات A (الدومين الرئيسي و`erp`) إلى 300 ثانية.
3. **في وقت هادئ (ليلاً)، على السيرفر القديم**: نسخة نهائية توقف كل الحاويات حتى لا تُكتب بيانات جديدة بعدها:
   ```bash
   bash backup.sh --final
   ```
4. **على السيرفر الجديد**:
   ```bash
   scp root@IP_القديم:/var/backups/vps-migration/vps-backup-*.tar* /root/
   curl -fsSLO https://raw.githubusercontent.com/ouss-trch/my-profil/refs/heads/claude/vps-migration-kvm2-kvm1-ciiw6o/vps-migration/restore.sh
   bash restore.sh /root/vps-backup-XXXXXXXX-XXXXXX.tar
   ```
   يجب أن ترى في النهاية: `same key as the old server, credentials will decrypt`.
5. **غيّر سجلات A** للدومينات إلى IP السيرفر الجديد.
6. **اختبر**: الدخول إلى n8n، فتح credential، تشغيل workflow، طلب COD تجريبي، الدخول إلى الـ ERP، تنبيه Telegram.
7. **إن حدثت مشكلة**: أرجِع سجلات A إلى IP القديم وشغّل على السيرفر القديم سطر `docker start ...` الذي طبعه `backup.sh --final`.

## 3. على KVM 1 فقط: أضف Swap

4 GB RAM كافية للاستعمال الحالي، لكن الـ swap يمنع توقف الحاويات عند ذروة مفاجئة (بناء صورة Docker، workflow صور/AI):

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.d/99-swap.conf
```

## ما الذي لا يتغير بعد النقل (إذا بقي نفس الدومين)

- روابط الـ webhooks (Telegram، WhatsApp، Messenger، متجر Shopify، الـ ERP) تبقى نفسها.
- حسابات Google OAuth تبقى متصلة لأن رابط الـ callback لم يتغير.
- اتصال MCP بـ n8n يبقى يعمل بنفس الرابط والتوكن.
- شهادات SSL تُنقل مع volume الـ Traefik، ثم تتجدد تلقائياً.

الشيء الوحيد الذي يتغير هو عنوان IP: إذا كانت خدمة خارجية تسمح فقط لـ IP السيرفر القديم، حدّثها.

import os from 'node:os';
import { config } from './config.js';
import { createApp } from './app.js';
import { startScheduler } from './services/scheduler.js';
import { db } from './db/index.js';
import { setupToken } from './lib/auth.js';

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  const tailscale = ips.filter((ip) => ip.startsWith('100.'));
  console.log('');
  console.log('  ERP TOURECHE يعمل الآن ✓');
  console.log(`  على هذا الجهاز:   http://localhost:${config.port}`);
  for (const ip of tailscale) console.log(`  عبر Tailscale:     http://${ip}:${config.port}`);
  for (const ip of ips.filter((x) => !x.startsWith('100.'))) console.log(`  على الشبكة المحلية: http://${ip}:${config.port}`);
  console.log(`  البيانات: ${config.dataDir}`);
  const token = setupToken();
  if (token) console.log(`  رمز الإعداد الأول (يُطلب عند الفتح من جهاز آخر): ${token}`);
  console.log('');
  startScheduler();
});

// إيقاف نظيف (docker stop / Ctrl+C): نغلق الاتصالات ثم قاعدة البيانات
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

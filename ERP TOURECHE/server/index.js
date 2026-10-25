import os from 'node:os';
import { config } from './config.js';
import { createApp } from './app.js';
import { startScheduler } from './services/scheduler.js';

const app = createApp();

app.listen(config.port, config.host, () => {
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
  console.log('');
  startScheduler();
});

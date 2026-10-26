import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { loadUser, requireAuth } from './lib/auth.js';
import { HttpError } from './lib/util.js';
import { IntegrationError } from './lib/http.js';
import { authRouter, usersRouter } from './routes/auth.js';
import { coreRouter, hooksRouter } from './routes/core.js';
import { ordersRouter, customersRouter, carriersRouter } from './routes/orders.js';
import { productsRouter } from './routes/products.js';
import { adsRouter } from './routes/ads.js';
import { dashboardRouter, aiRouter, tasksRouter, contactsRouter, financeRouter, pagesRouter, collectionsRouter } from './routes/misc.js';
import { advisorRouter, splitsRouter, goHandler, hitHandler } from './routes/insights.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
      // يتجاهله المتصفح على http (localhost)، ويُثبّت HTTPS عند الوصول عبر Tailscale أو دومين الـVPS
      hsts: { maxAge: 180 * 86400, includeSubDomains: false },
    }),
  );
  app.use(express.json({ limit: '4mb' }));
  app.use(loadUser);

  // حماية من الطلبات القادمة من مواقع أخرى (CSRF) — الكوكيز SameSite=Strict + فحص Origin
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/hooks/')) return next();
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      try {
        if (new URL(origin).host !== host && !config.allowedOrigins.includes(origin)) return next(new HttpError(403, 'bad_origin'));
      } catch {
        return next(new HttpError(403, 'bad_origin'));
      }
    }
    next();
  });

  const loginLimiter = rateLimit({ windowMs: 15 * 60e3, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
  app.use('/api/auth/login', loginLimiter);
  app.use('/api/auth/setup', loginLimiter);
  app.use('/api/hooks', rateLimit({ windowMs: 60e3, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '1.0.0' }));
  // رابط اختبار صفحات الهبوط (عام — يوضع في الإعلانات)
  app.get('/go/:slug', rateLimit({ windowMs: 60e3, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }), goHandler);
  app.post('/api/hooks/split/:slug/hit', rateLimit({ windowMs: 60e3, limit: 1200, standardHeaders: 'draft-8', legacyHeaders: false }), express.text({ type: '*/*', limit: '2kb' }), hitHandler);
  app.use('/api/auth', authRouter);
  app.use('/api/hooks', hooksRouter);
  app.use('/api', requireAuth);
  app.use('/api/users', usersRouter);
  app.use('/api', coreRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/carriers', carriersRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/ads', adsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/pages', pagesRouter);
  app.use('/api/finance', financeRouter);
  app.use('/api/collections', collectionsRouter);
  app.use('/api/advisor', advisorRouter);
  app.use('/api/splits', splitsRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found')));

  // الصور المرفوعة/المولّدة: للمستخدمين المسجلين فقط
  app.use('/uploads', requireAuth, express.static(config.uploadsDir, { fallthrough: false, maxAge: '7d' }));

  // واجهة React المبنية
  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/uploads|\/go\/).*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.type('text').send('ERP TOURECHE: الواجهة غير مبنية بعد — شغّل: npm run build'));
  }

  // معالج الأخطاء
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, details: err.details ?? null });
    if (err instanceof IntegrationError)
      return res.status(err.kind === 'config' ? 400 : 502).json({ error: err.message, service: err.service, kind: err.kind, details: err.details?.suggestions ? { suggestions: err.details.suggestions } : null });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    if (err?.statusCode === 404 || err?.status === 404) return res.status(404).json({ error: 'not_found' });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
    console.error('[error]', req.method, req.path, err);
    res.status(500).json({ error: 'internal_error' });
  });
  return app;
}

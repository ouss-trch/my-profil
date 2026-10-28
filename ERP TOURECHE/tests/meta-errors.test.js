import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graph } from '../server/integrations/meta.js';

// Meta وهمي يرفض بالخطأ المعطى
const refuse = (error) => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error }), { status: 400, headers: { 'content-type': 'application/json' } });
};
const cfg = { meta_access_token: 'EAAtest' };

test('meta errors: a dead token and an unpublished app get a message that says what to do, other errors keep Meta’s words', async () => {
  // حُذف التطبيق الذي أُنشئ به الرمز، أو مستخدم النظام
  refuse({ message: 'Error validating application. Application has been deleted.', type: 'OAuthException', code: 190 });
  await assert.rejects(graph(cfg, 'me'), (e) => e.kind === 'auth' && e.message === 'meta: meta_token_invalid' && e.details.code === 190);
  refuse({ message: 'Error validating access token: The session has been invalidated.', type: 'OAuthException', code: 190, error_subcode: 460 });
  await assert.rejects(graph(cfg, 'me'), (e) => e.message === 'meta: meta_token_invalid');

  // تطبيق جديد لم يُنشر: يمرّ إنشاء الحملة ثم ترفض Meta تصميم الإعلان
  refuse({
    message: 'Invalid parameter',
    type: 'OAuthException',
    code: 100,
    error_subcode: 1885183,
    error_user_title: 'Ads creative post was created by an app that is in development mode',
    error_user_msg: 'Ads creative post was created by an app that is in development mode. It must be in public to create this ad.',
  });
  await assert.rejects(graph(cfg, 'act_1/adcreatives', { method: 'POST', body: { name: 'x' } }), (e) => e.message === 'meta: meta_app_dev_mode' && e.details.subcode === 1885183);

  refuse({ message: 'Invalid parameter', type: 'OAuthException', code: 100, error_user_msg: 'The daily budget is too low.' });
  await assert.rejects(graph(cfg, 'act_1/campaigns', { method: 'POST', body: {} }), (e) => e.message === 'meta: The daily budget is too low.');
});

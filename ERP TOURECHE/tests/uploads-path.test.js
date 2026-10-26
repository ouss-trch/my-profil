import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { config } from '../server/config.js';
import { uploadPath } from '../server/integrations/images.js';

test('uploads: product image paths stay inside the uploads folder', () => {
  assert.equal(uploadPath('/uploads/1/123-abc.png'), path.join(path.resolve(config.uploadsDir), '1', '123-abc.png'));
  for (const bad of ['/uploads/../.secret-key', '/uploads/../toureche.db', '/uploads/1/../../.secret-key', '/uploads/', 'https://cdn.shopify.com/x.png', '/etc/passwd', null])
    assert.equal(uploadPath(bad), null, String(bad));
});

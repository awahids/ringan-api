// Smoke tests: importers + script sandbox worker logic. Run: node test/smoke.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const imp = require('../lib/importers');

let n = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(
  () => { n++; console.log('  ok  ' + name); },
  (e) => { console.error('  FAIL ' + name + '\n', e); process.exitCode = 1; },
);

(async () => {
  await ok('bru folder collection', () => {
    const cols = imp.filesToCollections([
      { path: 'api/bruno.json', content: '{"version":"1","name":"My API","type":"collection"}' },
      { path: 'api/collection.bru', content: 'headers {\n  X-App: ringan\n}\n\nauth {\n  mode: bearer\n}\n\nauth:bearer {\n  token: {{token}}\n}\n' },
      { path: 'api/environments/local.bru', content: 'vars {\n  baseUrl: http://localhost:3000\n}\nvars:secret [\n  token\n]\n' },
      { path: 'api/users/folder.bru', content: 'meta {\n  name: Users\n  seq: 1\n}\n' },
      {
        path: 'api/users/Get User.bru',
        content: [
          'meta {', '  name: Get User', '  type: http', '  seq: 2', '}', '',
          'post {', '  url: {{baseUrl}}/users/:id?verbose=true', '  body: json', '  auth: inherit', '}', '',
          'params:query {', '  verbose: true', '  ~debug: 1', '}', '',
          'params:path {', '  id: 7', '}', '',
          'body:json {', '  {', '    "a": {', '      "b": 1', '    }', '  }', '}', '',
          'vars:post-response {', '  uid: res.body.id', '}', '',
          'assert {', '  res.status: eq 200', '}', '',
          'tests {', '  test("x", function() {', '    expect(res.status).to.equal(200);', '  });', '}', '',
        ].join('\n'),
      },
    ]);
    assert.strictEqual(cols.length, 1);
    const c = cols[0];
    assert.strictEqual(c.name, 'My API');
    assert.strictEqual(c.auth.type, 'bearer');
    assert.strictEqual(c.headers[0].key, 'X-App');
    assert.strictEqual(c.environments[0].vars.find((v) => v.key === 'token').secret, true);
    const f = c.items[0];
    assert.strictEqual(f.type, 'folder');
    assert.strictEqual(f.name, 'Users');
    const r = f.items[0];
    assert.strictEqual(r.method, 'POST');
    assert.strictEqual(r.params.length, 2);
    assert.strictEqual(r.params[1].enabled, false);
    assert.strictEqual(r.pathParams[0].value, '7');
    assert.deepStrictEqual(JSON.parse(r.body.content), { a: { b: 1 } });
    assert.ok(r.postScript.includes('bru.setVar("uid"'));
    assert.strictEqual(r.asserts[0].value, 'eq 200');
    assert.ok(r.tests.startsWith('test("x"'));
  });

  await ok('postman v2.1', () => {
    const [c] = imp.parseText(JSON.stringify({
      info: { name: 'PM', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      variable: [{ key: 'host', value: 'https://x.io' }],
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{tk}}' }] },
      item: [{
        name: 'F',
        item: [{
          name: 'Login',
          event: [{ listen: 'test', script: { exec: ['pm.test("ok", () => pm.response.to.have.status(200));'] } }],
          request: {
            method: 'POST', header: [{ key: 'A', value: 'b' }],
            url: { raw: '{{host}}/login?x=1', query: [{ key: 'x', value: '1' }, { key: 'y', value: '2', disabled: true }] },
            body: { mode: 'raw', raw: '{"u":"a"}', options: { raw: { language: 'json' } } },
          },
        }],
      }],
    }));
    assert.strictEqual(c.auth.token, '{{tk}}');
    const r = c.items[0].items[0];
    assert.strictEqual(r.body.mode, 'json');
    assert.strictEqual(r.params.length, 2);
    assert.ok(r.tests.includes('pm.test'));
  });

  await ok('openapi 3', () => {
    const [c] = imp.parseText(JSON.stringify({
      openapi: '3.0.0', info: { title: 'Pets' }, servers: [{ url: 'https://pets.io/v1' }],
      components: {
        securitySchemes: { b: { type: 'http', scheme: 'bearer' } },
        schemas: { Pet: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } } },
      },
      paths: {
        '/pets/{petId}': {
          get: { tags: ['pets'], summary: 'Get pet', parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'integer', example: 3 } }, { name: 'q', in: 'query', schema: { type: 'string' } }] },
          put: { tags: ['pets'], operationId: 'updatePet', parameters: [{ name: 'petId', in: 'path' }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } },
        },
      },
    }));
    assert.strictEqual(c.vars[0].value, 'https://pets.io/v1');
    assert.strictEqual(c.auth.type, 'bearer');
    const get = c.items[0].items[0];
    assert.strictEqual(get.url, '{{baseUrl}}/pets/:petId');
    assert.strictEqual(get.pathParams[0].value, '3');
    assert.strictEqual(get.params[0].enabled, false);
    assert.deepStrictEqual(JSON.parse(c.items[0].items[1].body.content), { name: 'string', age: 0 });
  });

  await ok('curl (bash + windows cmd)', () => {
    const bash = "curl 'https://api.x.io/v1/items?page=2' \\\n  -H 'Authorization: Bearer abc' -H \"Content-Type: application/json\" \\\n  --data-raw '{\"name\":\"it'\"'\"'s\"}'";
    const r = imp.parseText(bash)[0].items[0];
    assert.strictEqual(r.method, 'POST');
    assert.strictEqual(r.body.mode, 'json');
    assert.strictEqual(JSON.parse(r.body.content).name, "it's");
    assert.strictEqual(r.params[0].key, 'page');
    const w = imp.parseText('curl ^"https://a.io/x^" -X PUT -H ^"accept: */*^" -d ^"a=1&b=2^"')[0].items[0];
    assert.strictEqual(w.method, 'PUT');
    assert.strictEqual(w.body.mode, 'form');
    assert.strictEqual(w.body.form[1].value, '2');
    const u = imp.parseText('curl -u user:pass -F file=@./a.png -F name=x https://a.io/up')[0].items[0];
    assert.strictEqual(u.auth.type, 'basic');
    assert.strictEqual(u.body.mode, 'multipart');
    assert.strictEqual(u.body.form[0].type, 'file');
  });

  await ok('bruno json export -> import roundtrip', () => {
    const src = imp.sampleCollection();
    src.environments[0].vars.push({ key: 'secretKey', value: 'shh', enabled: true, secret: true });
    const out = imp.toBrunoJson(src);
    const [back] = imp.parseText(JSON.stringify(out));
    assert.strictEqual(back.name, src.name);
    assert.strictEqual(back.items.length, 3);
    const p = back.items.find((x) => x.name === 'Get post by id');
    assert.strictEqual(p.pathParams[0].value, '1');
    assert.strictEqual(back.environments[0].vars.find((v) => v.key === 'secretKey').value, '', 'secret must not be exported');
    assert.strictEqual(back.items.find((x) => x.name === 'List posts').asserts.length, 4);
  });

  await ok('openapi YAML with response schemas', () => {
    const yamlSpec = [
      'openapi: 3.0.3',
      'info: { title: Users API }',
      'servers: [{ url: "https://u.io" }]',
      'paths:',
      '  /users/{id}:',
      '    get:',
      '      summary: Get user',
      '      parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]',
      '      responses:',
      '        "200":',
      '          description: ok',
      '          content:',
      '            application/json:',
      '              schema: { $ref: "#/components/schemas/User" }',
      '        4XX:',
      '          description: err',
      '          content: { application/json: { schema: { type: object, required: [message] } } }',
      'components:',
      '  schemas:',
      '    User:',
      '      type: object',
      '      required: [id, email]',
      '      properties:',
      '        id: { type: integer }',
      '        email: { type: string, format: email }',
      '        role: { type: string, enum: [admin, user], nullable: true }',
      '',
    ].join('\n');
    const [c] = imp.parseText(yamlSpec);
    assert.strictEqual(c.name, 'Users API');
    const r = c.items[0];
    assert.strictEqual(r.url, '{{baseUrl}}/users/:id');
    assert.strictEqual(r.schemaCheck, true);
    assert.deepStrictEqual(Object.keys(r.responseSchemas), ['200', '4XX']);
    assert.ok(c.openapi.components.schemas.User);
  });

  await ok('rejects unknown / html', () => {
    assert.throws(() => imp.parseText('<html></html>'), /HTML/);
    assert.throws(() => imp.parseText('{"foo":1}'), /tidak dikenali/);
  });

  await ok('.bru folder: write -> read roundtrip, merge keeps ids & secrets', () => {
    const os = require('os');
    const fsSync = require('../lib/fs-sync');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ringan-'));
    try {
      const col = imp.sampleCollection();
      col.headers = [{ key: 'X-App', value: 'ringan', enabled: true }];
      col.auth = { type: 'bearer', token: '{{token}}' };
      col.environments[0].vars.push({ key: 'token', value: 's3cret', enabled: true, secret: true });
      const folder = { id: 'f1', type: 'folder', name: 'Admin / Users', items: [col.items.pop()], headers: [], auth: { type: 'inherit' } };
      col.items.push(folder);
      col.items[0].docs = 'multi\nline';
      col.items[0].headers = [{ key: 'X-Off', value: 'a:b', enabled: false }];
      col.items[0].responseSchemas = { 200: { type: 'array' } };
      col.items[0].schemaCheck = true;
      col.fsPath = dir;
      const st = fsSync.writeCollectionDir(col);
      assert.ok(st.written >= 6, 'files written: ' + st.written);
      assert.ok(fs.existsSync(path.join(dir, 'Admin - Users', 'folder.bru')));
      assert.ok(!fs.readFileSync(path.join(dir, 'environments', 'Public.bru'), 'utf8').includes('s3cret'), 'secret value must not be on disk');
      // second write changes nothing
      assert.strictEqual(fsSync.writeCollectionDir(col).written, 0);
      const fresh = fsSync.readCollectionDir(dir);
      assert.strictEqual(fresh.name, col.name);
      assert.strictEqual(fresh.auth.type, 'bearer');
      assert.strictEqual(fresh.headers[0].key, 'X-App');
      const r0 = fresh.items.find((x) => x.name === 'List posts');
      assert.strictEqual(r0.docs, 'multi\nline');
      assert.strictEqual(r0.headers[0].enabled, false);
      assert.strictEqual(r0.headers[0].value, 'a:b');
      assert.strictEqual(r0.asserts.length, 4);
      assert.strictEqual(fresh.items.find((x) => x.type === 'folder').name, 'Admin / Users');
      const ids = [col.items[0].id, folder.id];
      fsSync.mergeFromDisk(col, fresh);
      assert.strictEqual(col.items.find((x) => x.name === 'List posts').id, ids[0]);
      assert.strictEqual(col.items.find((x) => x.type === 'folder').id, ids[1]);
      assert.deepStrictEqual(col.items.find((x) => x.name === 'List posts').responseSchemas, { 200: { type: 'array' } });
      assert.strictEqual(col.environments[0].vars.find((v) => v.key === 'token').value, 's3cret');
      // rename -> old file removed
      col.items.find((x) => x.name === 'List posts').name = 'All posts';
      const st2 = fsSync.writeCollectionDir(col);
      assert.strictEqual(st2.deleted, 1);
      assert.ok(fs.existsSync(path.join(dir, 'All posts.bru')) && !fs.existsSync(path.join(dir, 'List posts.bru')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await ok('export Postman v2.1 -> import roundtrip', () => {
    const x = require('../lib/exporters');
    const src = imp.sampleCollection();
    src.auth = { type: 'bearer', token: '{{token}}' };
    src.items.push({ id: 'f', type: 'folder', name: 'Forms', headers: [], auth: { type: 'inherit' }, items: [Object.assign(imp.parseText('curl -X POST https://a.io/f -d "a=1&b=2"')[0].items[0], { name: 'Form' })] });
    const out = x.exportCollection(src, 'postman', { includeEnv: true });
    const doc = JSON.parse(out.content);
    assert.ok(doc.info.schema.includes('v2.1.0'));
    assert.ok(doc.variable.some((v) => v.key === 'baseUrl'), 'active env exported as collection variable');
    const [back] = imp.parseText(out.content);
    assert.strictEqual(back.auth.token, '{{token}}');
    assert.deepStrictEqual(back.items.map((i) => i.name), ['List posts', 'Get post by id', 'Create post', 'Forms']);
    const get = back.items[1];
    assert.strictEqual(get.url, '{{baseUrl}}/posts/:id');
    assert.strictEqual(get.pathParams[0].value, '1');
    assert.strictEqual(back.items[2].body.mode, 'json');
    assert.strictEqual(back.items[3].items[0].body.mode, 'form');
    assert.ok(back.items[0].tests.includes('pm.test("res.status: eq 200"'), 'asserts converted to pm.test');
    assert.ok(/shim Ringan\/Bruno/.test(back.items[2].tests), 'bru.* scripts get a shim');
  });

  await ok('export OpenAPI 3 -> import roundtrip, duplicates merged', () => {
    const x = require('../lib/exporters');
    const src = imp.sampleCollection();
    src.auth = { type: 'bearer', token: '{{token}}' };
    src.items[1].responseSchemas = { 200: { $ref: '#/components/schemas/Post' } };
    src.openapi = { components: { schemas: { Post: { type: 'object', properties: { id: { type: 'integer' } } } } } };
    const dup = JSON.parse(JSON.stringify(src.items[2]));
    dup.id = 'dup'; dup.name = 'Create post 2'; dup.body.content = '{"title":"Lain"}';
    src.items.push(dup);
    const out = x.exportCollection(src, 'openapi', { samples: { [src.items[0].id]: { status: 200, body: '[{"id":1,"title":"x"}]' } } });
    const doc = JSON.parse(out.content);
    assert.strictEqual(doc.openapi, '3.0.3');
    assert.deepStrictEqual(doc.servers, [{ url: 'https://jsonplaceholder.typicode.com' }]);
    assert.deepStrictEqual(doc.security, [{ bearerAuth: [] }]);
    assert.strictEqual(doc.paths['/posts/{id}'].get.parameters[0].name, 'id');
    assert.strictEqual(doc.paths['/posts/{id}'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/Post');
    assert.strictEqual(doc.paths['/posts'].get.responses['200'].content['application/json'].schema.type, 'array', 'response inferred from sample');
    const ex = doc.paths['/posts'].post.requestBody.content['application/json'].examples;
    assert.deepStrictEqual(Object.keys(ex).sort(), ['Create_post', 'Create_post_2']);
    assert.ok(out.warnings.some((w) => /digabung/.test(w)));
    const [back] = imp.parseText(out.content);
    let n = 0;
    (function w(items) { for (const i of items) i.type === 'folder' ? w(i.items) : n++; })(back.items);
    assert.strictEqual(n, 3);
    const yamlOut = x.exportCollection(src, 'openapi-yaml');
    assert.ok(yamlOut.content.startsWith('openapi: 3.0.3'));
    assert.strictEqual(imp.parseText(yamlOut.content)[0].name, src.name);
  });

  await ok('live sync: spec v2 merged without losing user work', () => {
    const live = require('../lib/live-sync');
    const spec = (v2) => JSON.stringify({
      openapi: '3.0.3', info: { title: 'Shop', version: v2 ? '2' : '1' }, servers: [{ url: '/' }],
      paths: Object.assign({
        '/items': { get: { tags: ['items'], summary: 'List items', parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', example: 1 } }].concat(v2 ? [{ name: 'q', in: 'query', required: true, schema: { type: 'string', example: 'x' } }] : []), responses: { 200: { description: 'ok' } } } },
        '/items/{id}': { put: { tags: ['items'], summary: 'Update item', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: v2 ? { name: { type: 'string' }, price: { type: 'number' } } : { name: { type: 'string' } } } } } }, responses: { 200: { description: 'ok' } } } },
        '/orders': { post: { tags: ['orders'], summary: 'Create order', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: v2 ? { qty: { type: 'integer' }, note: { type: 'string' } } : { qty: { type: 'integer' } } } } } }, responses: { 201: { description: 'created' } } } },
      }, v2 ? { '/health': { get: { summary: 'Health', responses: { 200: { description: 'ok' } } } } } : { '/legacy': { get: { tags: ['items'], summary: 'Legacy', responses: { 200: { description: 'ok' } } } } }),
    });
    const [col] = imp.parseText(spec(false));
    const find = (c, name) => { let f; (function w(items) { for (const i of items) i.type === 'folder' ? w(i.items) : i.name === name && (f = i); })(c.items); return f; };
    // user work
    const list = find(col, 'List items');
    list.tests = 'test("ok", () => expect(res.status).to.equal(200));';
    list.asserts = [{ key: 'res.status', value: 'eq 200', enabled: true }];
    list.params[0].value = '7'; list.params[0].enabled = true; list.url = '{{baseUrl}}/items?page=7';
    const upd = find(col, 'Update item'); // body untouched -> should follow spec
    const order = find(col, 'Create order');
    order.body.content = '{ "qty": 99 }'; // user edited -> must be kept
    order.name = 'Buat order (custom)'; // renamed -> must be kept
    const legacy = find(col, 'Legacy');
    legacy.tests = 'test("x", () => {});';
    // a user copy of the same endpoint must never take the spec match
    const copy = JSON.parse(JSON.stringify(list));
    copy.id = 'copy1'; copy.name = 'List items (copy)';
    for (const k of ['specKey', 'specName', 'specDocs', 'specBodyHash', 'specParamKeys']) delete copy[k];
    copy.specDetached = true;
    col.items.unshift(copy);
    const [fresh] = imp.parseText(spec(true));
    const { diff } = live.mergeSpec(col, fresh);
    assert.deepStrictEqual(diff.added, ['GET /health']);
    assert.deepStrictEqual(diff.removed, ['GET Legacy']);
    assert.ok(diff.changed.includes('GET List items') && diff.changed.includes('PUT Update item'), JSON.stringify(diff));
    assert.ok(diff.bodyKept.some((x) => x.includes('Buat order')));
    const list2 = find(col, 'List items');
    assert.strictEqual(list2, list, 'same object kept');
    assert.ok(list2.tests.includes('test("ok"') && list2.asserts.length === 1, 'tests/asserts kept');
    assert.strictEqual(list2.params.find((p) => p.key === 'page').value, '7', 'user param value kept');
    assert.ok(list2.params.some((p) => p.key === 'q'), 'new param added');
    assert.ok(list2.url.includes('page=7') && list2.url.includes('q=x'));
    assert.ok(!copy.params.some((p) => p.key === 'q') && col.items[0] === copy, 'copy untouched and not moved');
    assert.deepStrictEqual(Object.keys(JSON.parse(find(col, 'Update item').body.content)), ['name', 'price'], 'untouched body follows spec');
    assert.strictEqual(find(col, 'Buat order (custom)').body.content, '{ "qty": 99 }', 'edited body kept');
    const removedFolder = col.items.find((x) => x.name === live.REMOVED_FOLDER);
    assert.ok(removedFolder && removedFolder.items[0].tests.includes('test("x"'), 'removed endpoint moved, not deleted');
    // spec v1 again -> Legacy restored, folder gone
    const [back] = imp.parseText(spec(false));
    const d2 = live.mergeSpec(col, back);
    assert.deepStrictEqual(d2.diff.restored, ['GET Legacy']);
    assert.deepStrictEqual(d2.diff.removed, ['GET Health']);
    assert.deepStrictEqual(col.items.find((x) => x.name === live.REMOVED_FOLDER).items.map((x) => x.name), ['Health'], 'only Health left in removed folder');
  });

  await ok('updates: versions, changelog, release check', async () => {
    const http = require('http');
    const srv = http.createServer((q, r) => {
      r.writeHead(200, { 'Content-Type': 'application/json' });
      r.end(JSON.stringify([
        { tag_name: 'v9.1.0-rc.1', prerelease: true, draft: false, body: 'rc', html_url: 'x', assets: [] },
        { tag_name: 'v9.0.0', prerelease: false, draft: false, body: '- baru', html_url: 'https://example/v9', published_at: '2030-01-01', assets: [{ name: 'RinganAPI-Setup-9.0.0.exe', browser_download_url: 'u', size: 1 }] },
        { tag_name: 'v0.1.0', prerelease: false, draft: false, body: 'lama', html_url: 'y', assets: [] },
      ]));
    });
    await new Promise((res) => srv.listen(0, '127.0.0.1', res));
    process.env.RINGAN_UPDATE_API = `http://127.0.0.1:${srv.address().port}`;
    delete require.cache[require.resolve('../lib/updates')];
    const u = require('../lib/updates');
    try {
      assert.ok(u.compareVersions('1.10.0', '1.9.9') > 0);
      assert.ok(u.compareVersions('1.0.0', '1.0.0-beta.2') > 0);
      assert.ok(u.compareVersions('v1.0.0', '1.0.0') === 0);
      const cl = u.parseChangelog('# C\n\n## [Unreleased]\n\n## [1.2.0] - 2026-12-01\n### Ditambahkan\n- a\n\n## [1.1.0] - 2026-11-01\n- b\n\n[1.2.0]: https://x\n');
      assert.deepStrictEqual(cl.map((e) => [e.version, e.date, e.unreleased]), [['Unreleased', null, true], ['1.2.0', '2026-12-01', false], ['1.1.0', '2026-11-01', false]]);
      assert.ok(!cl[2].body.includes('https://x'), 'link refs stripped');
      assert.ok(u.readChangelog().some((e) => e.version === '1.0.0'), 'bundled CHANGELOG.md readable');
      const r = await u.check({ force: true });
      assert.strictEqual(r.hasUpdate, true);
      assert.strictEqual(r.latest, '9.0.0', 'prerelease ignored');
      assert.deepStrictEqual(r.newer.map((x) => x.version), ['9.0.0']);
      assert.strictEqual(r.kind, 'node');
      assert.strictEqual(r.download, null, 'node version gets the release page, not an installer');
      assert.strictEqual(r.releaseUrl, 'https://example/v9');
    } finally { srv.close(); delete process.env.RINGAN_UPDATE_API; }
  });

  // ---- sandbox worker, executed in Node with a fake `self`
  const src = fs.readFileSync(path.join(__dirname, '../public/sandbox-worker.js'), 'utf8');
  const runJob = (job) => new Promise((resolve) => {
    const self = { postMessage: resolve };
    new Function('self', src)(self);
    self.onmessage({ data: Object.assign({ id: 1 }, job) });
  });
  const res = { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json; charset=utf-8' }, body: { id: 5, items: [1, 2, 3], name: 'Ringan', token: 'T' }, responseTime: 120, size: 50, url: 'http://x' };
  const vars = () => ({ env: { baseUrl: 'http://x' }, envName: 'local', collection: {}, request: {}, runtime: {} });

  await ok('sandbox: declarative asserts', async () => {
    const out = await runJob({
      asserts: [
        { key: 'res.status', value: 'eq 200' }, { key: 'res.body.items.length', value: 'gt 2' }, { key: 'res.body.items', value: 'isArray' },
        { key: 'res.headers.content-type', value: 'contains json' }, { key: 'res.body.name', value: 'startsWith Rin' }, { key: 'res.body.id', value: 'in 4,5,6' },
        { key: 'res.responseTime', value: 'between 0, 500' }, { key: 'res.body.missing', value: 'isUndefined' },
        { key: 'res.status', value: 'eq 201' },
      ],
      res, vars: vars(),
    });
    assert.strictEqual(out.tests.length, 9);
    assert.deepStrictEqual(out.tests.map((t) => t.passed), [true, true, true, true, true, true, true, true, false]);
    assert.ok(/expected 200 to equal 201/.test(out.tests[8].error), out.tests[8].error);
  });

  await ok('sandbox: tests, expect, pm, vars', async () => {
    const out = await runJob({
      scripts: [{ label: 'post', code: 'bru.setEnvVar("token", res.body.token); bru.setVar("n", res("items[1]")); console.log("hi", {a:1});' }],
      tests: [{
        label: 'tests',
        code: [
          'test("eq", () => expect(res.status).to.equal(200));',
          'test("prop", () => expect(res.body).to.have.property("name").that.is.a("string"));',
          'test("not", () => expect(res.body.items).to.not.include(9));',
          'test("deep", () => expect(res.body.items).to.eql([1,2,3]));',
          'test("async", async () => { await bru.sleep(5); expect(1).to.be.below(2); });',
          'pm.test("pm status", () => pm.response.to.have.status(200));',
          'pm.test("pm json", () => pm.expect(pm.response.json().id).to.eql(5));',
          'test("fails", () => expect(res.body.name).to.equal("x"));',
        ].join('\n'),
      }],
      res, vars: vars(),
    });
    assert.strictEqual(out.error, null);
    assert.deepStrictEqual(out.tests.map((t) => [t.name, t.passed]), [['eq', true], ['prop', true], ['not', true], ['deep', true], ['async', true], ['pm status', true], ['pm json', true], ['fails', false]]);
    assert.strictEqual(out.vars.envSet.token, 'T');
    assert.strictEqual(out.vars.runtime.n, 2);
    assert.ok(out.logs[0].msg.startsWith('hi {'));
  });

  await ok('sandbox: pre-request modifies req; script error reported', async () => {
    const out = await runJob({
      scripts: [{ label: 'Pre-request script', code: 'req.setHeader("X-T", "1"); req.setUrl(req.getUrl() + "?a=1"); req.setBody({k: bru.interpolate("{{baseUrl}}")});' }],
      req: { method: 'GET', url: 'http://x/p', headers: {}, body: undefined }, vars: vars(),
    });
    assert.strictEqual(out.req.headers['X-T'], '1');
    assert.strictEqual(out.req.url, 'http://x/p?a=1');
    assert.deepStrictEqual(out.req.body, { k: 'http://x' });
    const bad = await runJob({ scripts: [{ label: 'Pre-request script', code: 'nope();' }], req: { method: 'GET', url: 'u', headers: {} }, vars: vars() });
    assert.ok(/Pre-request script: nope is not defined/.test(bad.error), bad.error);
  });

  await ok('sandbox: response schema validation', async () => {
    const schema = {
      schemas: { 200: { $ref: '#/components/schemas/User' }, '4XX': { type: 'object', required: ['message'] } },
      components: { schemas: { User: { type: 'object', required: ['id', 'email'], properties: { id: { type: 'integer' }, email: { type: 'string', format: 'email' }, role: { type: 'string', enum: ['admin', 'user'], nullable: true }, tags: { type: 'array', items: { type: 'string' } } } } } },
    };
    const mk = (status, body) => ({ status, statusText: '', headers: {}, body, responseTime: 1, size: 1, url: 'u' });
    const good = await runJob({ schema, res: mk(200, { id: 1, email: 'a@b.co', role: null, tags: ['x'] }), vars: vars() });
    assert.strictEqual(good.tests[0].passed, true, good.tests[0].error);
    const bad = await runJob({ schema, res: mk(200, { id: '1', email: 'nope', role: 'root', tags: [1] }), vars: vars() });
    assert.strictEqual(bad.tests[0].passed, false);
    for (const frag of ['$.id: harus bertipe integer', '$.email: format email', '$.role: harus salah satu', '$.tags[0]: harus bertipe string']) assert.ok(bad.tests[0].error.includes(frag), bad.tests[0].error);
    const missing = await runJob({ schema, res: mk(404, {}), vars: vars() });
    assert.ok(/field wajib "message"/.test(missing.tests[0].error), missing.tests[0].error);
    const undocumented = await runJob({ schema, res: mk(500, {}), vars: vars() });
    assert.ok(/tidak didefinisikan/.test(undocumented.tests[0].error));
  });

  await ok('scenario: steps run in order, values flow between steps', async () => {
    const E = require('../public/engine');
    const login = { id: 'l', type: 'request', name: 'Login', method: 'POST', url: 'http://api/login', params: [], pathParams: [], headers: [], body: { mode: 'none', content: '', form: [] }, auth: { type: 'none' }, vars: [], asserts: [], preScript: '', postScript: '', tests: '' };
    const me = { ...JSON.parse(JSON.stringify(login)), id: 'm', name: 'Me', method: 'GET', url: 'http://api/me?t={{token}}' };
    const col = { id: 'c', name: 'C', items: [login, me], headers: [], auth: { type: 'none' }, vars: [], environments: [], preScript: '', postScript: '', tests: '' };
    const sent = [];
    const ctx = {
      runtime: {}, settings: {},
      send: async (p) => { sent.push(p.url); return p.url.endsWith('/login') ? { status: 201, statusText: 'Created', headers: { 'x-req': 'abc' }, bodyText: '{"data":{"token":"T1"}}', timeMs: 1, size: 1, url: p.url } : { status: 200, statusText: 'OK', headers: {}, bodyText: '{}', timeMs: 1, size: 1, url: p.url }; },
      sandbox: async () => ({ tests: [], logs: [], vars: { runtime: {}, envSet: {}, envUnset: [] }, error: null }),
    };
    assert.ok(E.statusMatches('2xx', 201) && E.statusMatches('200,201', 201) && !E.statusMatches('200', 404));
    assert.strictEqual(E.getPath({ a: [{ b: 7 }] }, 'a[0].b'), 7);
    const scn = { id: 's', name: 'S', stopOnFail: true, steps: [
      { id: '1', reqId: 'l', expectStatus: '201', extract: [{ from: 'body', path: 'data.token', var: 'token', scope: 'runtime' }, { from: 'header', path: 'X-Req', var: 'rid' }] },
      { id: '2', reqId: 'm', expectStatus: '2xx', extract: [] },
    ] };
    const out = await E.runScenario(scn, col, ctx);
    assert.ok(out.ok, JSON.stringify(out.steps.map((s) => s.result && s.result.tests)));
    assert.strictEqual(sent[1], 'http://api/me?t=T1', 'extracted value used by the next step');
    assert.strictEqual(ctx.runtime.c.rid, 'abc');
    scn.steps[0].expectStatus = '200';
    const failed = await E.runScenario(scn, col, ctx);
    assert.ok(!failed.ok && failed.steps.length === 1, 'stops at the failing step');
  });

  await ok('scenario: saved next to .bru files and read back by path', () => {
    const fsSync = require('../lib/fs-sync');
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ringan-scn-'));
    try {
      const col = imp.sampleCollection();
      const [a, b] = col.items;
      col.scenarios = [{ id: 's1', name: 'Alur', stopOnFail: true, steps: [{ id: 'x', reqId: a.id, expectStatus: '200', enabled: true, extract: [{ from: 'body', path: '[0].id', var: 'pid', scope: 'runtime' }] }, { id: 'y', reqId: b.id, enabled: true, extract: [] }] }];
      col.fsPath = dir;
      fsSync.writeCollectionDir(col);
      const file = JSON.parse(fs.readFileSync(path.join(dir, 'ringan-scenarios.json'), 'utf8'));
      assert.deepStrictEqual(file.scenarios[0].steps.map((s) => s.request), ['List posts.bru', 'Get post by id.bru']);
      const fresh = fsSync.readCollectionDir(dir);
      assert.ok(fresh.scenarios[0].steps.every((s) => s.reqId), 'requests resolved by path');
      fsSync.mergeFromDisk(col, fresh);
      assert.deepStrictEqual(col.scenarios[0].steps.map((s) => s.reqId), [a.id, b.id], 'ids preserved after merge');
      col.scenarios = [];
      fsSync.writeCollectionDir(col);
      assert.ok(!fs.existsSync(path.join(dir, 'ringan-scenarios.json')), 'file removed when no scenarios remain');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await ok('export: HTML documentation masks secrets', () => {
    const { exportCollection } = require('../lib/exporters');
    const col = imp.sampleCollection();
    col.environments[0].vars.push({ key: 'apiKey', value: 'SUPER-SECRET', enabled: true, secret: true });
    col.items[0].headers = [{ key: 'Authorization', value: 'Bearer LITERAL-TOKEN', enabled: true }];
    col.items[1].auth = { type: 'bearer', token: '{{token}}' };
    const out = exportCollection(col, 'html', { samples: { [col.items[0].id]: { status: 200, body: '[{"id":1}]' } } });
    assert.ok(out.filename.endsWith('.docs.html') && out.mime === 'text/html');
    assert.ok(out.content.startsWith('<!doctype html>'));
    for (const r of col.items) assert.ok(out.content.includes(r.name.replace(/&/g, '&amp;')), r.name);
    assert.ok(!out.content.includes('SUPER-SECRET') && !out.content.includes('LITERAL-TOKEN'), 'secrets must not leak');
    assert.ok(out.content.includes('{{token}}'), 'variable references are kept');
    assert.ok(out.content.includes('curl -X POST'), 'cURL example');
    assert.ok(out.content.includes('&quot;id&quot;: 1'), 'example response');
  });

  await ok('i18n: dictionary covers static UI strings', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n.js'), 'utf8');
    const win = {};
    new Function('window', 'document', 'MutationObserver', 'NodeFilter', src)(win, { documentElement: {}, body: {} }, class { observe() {} disconnect() {} }, {});
    const I = win.RinganI18n;
    I.setLang('en');
    assert.strictEqual(I.translate('  Batal '), '  Cancel ');
    assert.strictEqual(I.translate('Skenario "A": lulus (2/2 langkah)'), 'Scenario "A": passed (2/2 steps)');
    assert.strictEqual(I.translate('Nama request saya'), 'Nama request saya', 'unknown text left alone');
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    for (const s of ['Pengaturan', 'Koleksi baru / template…', 'Hapus semua history', '▶ Jalankan skenario', 'Dokumentasi HTML', 'Bahasa tampilan']) {
      assert.ok(app.includes(`'${s}'`), `"${s}" still used in app.js`);
      assert.notStrictEqual(I.translate(s), s, `"${s}" has an English translation`);
    }
  });

  console.log(`\n${n} checks passed${process.exitCode ? ' (with failures)' : ''}`);
})();

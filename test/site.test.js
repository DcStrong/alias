import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.js';
import {FOOTER_LINKS} from '../site.js';

test('подвал, страницы сайта, robots и sitemap доступны',async t=>{
 const {server}=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const base=`http://127.0.0.1:${server.address().port}`;
 const index=await (await fetch(base+'/')).text();
 assert.match(index,/<meta name="description"/);assert.ok(!index.includes('<!--'));
 for(const [href,label] of FOOTER_LINKS){
  assert.ok(index.includes(`href="${href}"`),href);
  const r=await fetch(base+href);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/html/);
  const body=await r.text();assert.ok(body.includes('<h1>'));assert.ok(body.includes(`href="${href}"`));assert.ok(label);
 }
 assert.match(await (await fetch(base+'/robots.txt')).text(),/Disallow: \/api\//);
 const map=await (await fetch(base+'/sitemap.xml')).text();assert.ok(map.includes('/privacy</loc>'));
 assert.equal((await fetch(base+'/favicon.svg')).status,200);
 assert.equal((await fetch(base+'/hints.js')).status,404,'Толкования не отдаются клиенту');
});

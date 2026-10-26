// Real localhost server: service workers do not work with route-only fixture hosting.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),base='/personal-project-hq/';
(async()=>{
 let revision=1,reads=0;
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname===base+'test.html'){res.setHeader('Content-Type','text/html');return res.end('<input id="draft"><script type="module" src="./js/pwa.js"></script>');}
  if(pathname===base+'private-file')return res.end(String(++reads));
  if(!pathname.startsWith(base)){res.statusCode=404;return res.end();}
  const file=path.join(root,pathname.slice(base.length)||'index.html');
  try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.webmanifest')?'application/manifest+json':file.endsWith('.png')?'image/png':'text/html');const bytes=fs.readFileSync(file);res.end(file.endsWith('sw.js')?Buffer.concat([bytes,Buffer.from('\n// revision '+revision)]):bytes);}catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 let browser;
 try{
  const manifest=await (await fetch(origin+base+'manifest.webmanifest')).json();
  assert.equal(manifest.start_url,base);assert.equal(manifest.scope,base);assert.equal(manifest.display,'standalone');
  for(const icon of [...manifest.icons,{src:'./images/apple-touch-icon.png',sizes:'180x180'}]){
   const bytes=Buffer.from(await(await fetch(new URL(icon.src,origin+base))).arrayBuffer());
   assert.equal(bytes.readUInt32BE(16),Number(icon.sizes.split('x')[0]));assert.equal(bytes.readUInt32BE(20),Number(icon.sizes.split('x')[1]));
  }
  const html=await(await fetch(origin+base)).text();
  assert.match(html,/rel="manifest" href="\.\/manifest.webmanifest"/);assert.match(html,/apple-mobile-web-app-capable" content="yes"/);assert.match(html,/apple-touch-icon/);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  const page=await browser.newPage();page.setDefaultTimeout(15000);await page.goto(origin+base+'test.html');
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  assert.equal(await page.evaluate(async()=> (await navigator.serviceWorker.ready).scope),origin+base);
  assert.equal(await page.evaluate(async()=>!!await navigator.serviceWorker.getRegistration('/another-project/')),false);
  await page.locator('#draft').fill('Unsaved work');
  assert.deepEqual(await page.evaluate(async()=>[await(await fetch('./private-file')).text(),await(await fetch('./private-file')).text()]),['1','2']);
  assert.deepEqual(await page.evaluate(()=>caches.keys()),[]);
  revision=2;
  await page.evaluate(async()=>{
   const reg=await navigator.serviceWorker.ready;
   await new Promise(async(resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Worker update timed out')),10000);
    navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();},{once:true});
    await reg.update();
   });
  });
  assert.equal(await page.locator('#draft').inputValue(),'Unsaved work');
  await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  assert.deepEqual(await page.evaluate(()=>caches.keys()),[]);
  console.log('PWA: subpath metadata/icons, real registration/scope, network-only private requests, worker update without reload, relaunch passed.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Game} from './game.js';
export function createServer(options={}) {
 const game=new Game(options), streams=new Map();
 const broadcast=r=>{ for(const [res,{room,d}] of streams) if(room===r&&!res.writableEnded&&!res.destroyed) res.write(`data: ${JSON.stringify(game.view(r,d))}\n\n`); };
 const server=http.createServer(async(req,res)=>{
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try {
   const url=new URL(req.url,'http://localhost');
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
   res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
   if(req.method==='GET'&&!url.pathname.startsWith('/api/')) {
    const files={'/':'index.html','/app.js':'app.js','/guesser.js':'guesser.js','/style.css':'style.css'};const file=files[url.pathname];if(!file)return json(404,{error:'Не найдено'});
    const data=await readFile(new URL(`./public/${file}`,import.meta.url));res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-cache'});return res.end(data);
   }
   if(req.method==='POST') {
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return json(403,{error:'Недопустимый источник запроса'});
    if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'Нужен JSON'});
   }
   let body={};if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192){json(413,{error:'Запрос слишком большой'});return;}}body=JSON.parse(raw||'{}');}
   if(url.pathname==='/api/rooms'&&req.method==='POST') {
    if(game.rooms.size>=500)return json(503,{error:'Сервер заполнен'});
    const room=game.create(),d=game.join(room);res.setHeader('Set-Cookie',`alias_${room.code}=${d.token}; HttpOnly; SameSite=Strict; Path=/api/rooms/${room.code}${(req.socket.encrypted||process.env.COOKIE_SECURE==='true')?'; Secure':''}`);return json(201,game.view(room,d));
   }
   const match=url.pathname.match(/^\/api\/rooms\/([A-F0-9]{6})\/(join|events|action)$/);if(!match)return json(404,{error:'Не найдено'});
   const room=game.rooms.get(match[1]);if(!room)return json(404,{error:'Комната не найдена или сервер был перезапущен'});
   const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`alias_${room.code}=`))?.split('=')[1];
   if(match[2]==='join'&&req.method==='POST') {
    const d=game.join(room,token);res.setHeader('Set-Cookie',`alias_${room.code}=${d.token}; HttpOnly; SameSite=Strict; Path=/api/rooms/${room.code}${(req.socket.encrypted||process.env.COOKIE_SECURE==='true')?'; Secure':''}`);room.version++;broadcast(room);return json(200,game.view(room,d));
   }
   const d=game.device(room,token);
   if(match[2]==='events'&&req.method==='GET') {
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');
    streams.set(res,{room,d});d.connections++;room.version++;room.touched=game.now();broadcast(room);
    req.on('close',()=>{streams.delete(res);d.connections=Math.max(0,d.connections-1);if(!d.connections)d.disconnectedAt=game.now();room.touched=game.now();room.version++;broadcast(room);});return;
   }
   if(match[2]==='action'&&req.method==='POST') {if(game.tick(room))broadcast(room);game.action(room,d,body);broadcast(room);json(200,game.view(room,d));if(d.left)for(const [stream,s]of streams)if(s.d===d)stream.end();return;}
   return json(405,{error:'Метод не поддерживается'});
  }catch(error){json(400,{error:error instanceof SyntaxError?'Некорректный JSON':error.message});}
 });
 const timer=setInterval(()=>{for(const r of game.rooms.values()){if(game.tick(r))broadcast(r);if(!r.devices.some(d=>d.connections)&&game.now()-r.touched>24*3600000)game.rooms.delete(r.code);}for(const res of streams.keys())if(!res.writableEnded&&!res.destroyed)res.write(': heartbeat\n\n');},250);timer.unref();
 server.on('close',()=>{clearInterval(timer);for(const res of [...streams.keys()]){streams.delete(res);res.end();}});
 return {server,game};
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)) {
 const port=Number(process.env.PORT||3000);const {server}=createServer();server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Alias: http://localhost:${server.address().port} (HOST=${process.env.HOST||'0.0.0.0'})`));
}

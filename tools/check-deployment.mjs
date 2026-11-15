import {WebSocket} from 'ws';
import fs from 'node:fs/promises';
const origin='https://contra-3d.onrender.com',backend='https://contra-3d-room.onrender.com';
const health=await fetch(backend+'/health').then(r=>r.json());
if(!health.ready)throw Error('Backend map is not ready');
const clients=[];
try{
 const join=()=>new Promise((resolve,reject)=>{const ws=new WebSocket(backend.replace('https:','wss:')+'/ws',{origin});clients.push(ws);const result={ws,states:[]};const timeout=setTimeout(()=>reject(Error('WebSocket timeout')),15000);ws.on('error',reject);ws.on('message',bytes=>{const m=JSON.parse(bytes);if(m.type==='welcome')result.welcome=m;if(m.type==='state'){result.states.push(m);if(result.welcome&&result.states.length>=3){clearTimeout(timeout);resolve(result);}}});});
 const a=await join(),b=await join();
 if(a.welcome.id===b.welcome.id)throw Error('Duplicate player IDs');
 await new Promise(r=>setTimeout(r,250));
 const state=b.states.at(-1),humans=state.actors.filter(a=>!a.bot);
 if(state.actors.length!==10||humans.length<2)throw Error('Clients are not in the same ten-slot room');
 const result={at:new Date().toISOString(),origin,backend,health,players:[a.welcome.id,b.welcome.id],actors:state.actors.length,humans:humans.length,bots:state.actors.filter(a=>a.bot).length,tick:state.tick,tlsWebSocket:true};
 await fs.mkdir(new URL('../art/',import.meta.url),{recursive:true});await fs.writeFile(new URL('../art/deployment-check.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{for(const ws of clients)ws.close();}

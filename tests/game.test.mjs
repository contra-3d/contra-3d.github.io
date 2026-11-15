import test from 'node:test';
import assert from 'node:assert/strict';
import {CollisionWorld,rayActor} from '../shared/world.mjs';
import {createGame,sanitizeInput} from '../shared/game.mjs';
import {loadGameAssets,createContraServer} from '../server/app.mjs';
import {WebSocket} from 'ws';
const floor=new Float32Array([-50,0,-50,-50,0,50,50,0,50,-50,0,-50,50,0,50,50,0,-50]);
test('capsule stays grounded and hits the floor',()=>{const world=new CollisionWorld(floor);const a={x:0,y:4,z:0,yaw:0,vy:0};for(let i=0;i<150;i++)world.move(a,{},1/30);assert.ok(Math.abs(a.y)<.01);assert.ok(a.grounded);assert.ok(rayActor({x:0,y:1,z:3},{x:0,y:0,z:-1},a)<3);});
test('input cannot inject coordinates or nonfinite angles',()=>{const result=sanitizeInput({yaw:Infinity,pitch:99,forward:true,x:999999,seq:-100});assert.ok(Number.isFinite(result.yaw));assert.equal(result.pitch,1.45);assert.equal(result.x,undefined);assert.equal(result.seq,0);});
test('two online clients share ten authoritative slots and disconnect restores bots',async()=>{
 const world=new CollisionWorld(floor),navigation={nearestPoint:p=>p,findPath:(a,b)=>[a,b],spawns:{blue:[{x:-10,y:0,z:10}],red:[{x:10,y:0,z:-10}]}};
 const app=await createContraServer({world,navigation});const address=await app.start({port:0,host:'127.0.0.1'});const url=`ws://127.0.0.1:${address.port}/ws`,clients=[];
 try{const join=()=>new Promise((resolve,reject)=>{const ws=new WebSocket(url);clients.push(ws);ws.on('error',reject);ws.on('message',bytes=>{const m=JSON.parse(bytes);if(m.type==='welcome')resolve({ws,id:m.id});});});const a=await join(),b=await join();assert.notEqual(a.id,b.id);assert.equal(app.game.actors.filter(a=>!a.bot).length,2);assert.equal(app.game.actors.length,10);a.ws.send(JSON.stringify({type:'input',x:999999,hp:9999,yaw:0,pitch:0,forward:true}));await new Promise(r=>setTimeout(r,180));assert.ok(Math.abs(app.game.actors.find(p=>p.id===a.id).x)<100);assert.equal(app.game.actors.find(p=>p.id===a.id).hp,100);a.ws.close();await new Promise(r=>setTimeout(r,70));assert.equal(app.game.actors.filter(a=>!a.bot).length,1);
 }finally{for(const client of clients)client.terminate();await app.close();}
});
test('real Sandstone bots navigate, fight, plant at A/B and resolve bombs',async()=>{
 const {world,navigation}=await loadGameAssets();assert.ok(navigation);const game=createGame({world,navigation});const seen=new Map();
 for(let i=0;i<30*240;i++){game.step(1/30);if(i%20===0)for(const e of game.snapshot().events)seen.set(e.id,e);}
 const events=[...seen.values()];assert.ok(events.some(e=>e.type==='shot'));assert.ok(events.some(e=>e.type==='hit'));assert.ok(events.some(e=>e.type==='kill'));assert.ok(events.some(e=>e.type==='bombPlanted'&&e.site==='A'));assert.ok(events.some(e=>e.type==='bombPlanted'&&e.site==='B'));assert.ok(events.some(e=>e.type==='bombDefused'||e.type==='bombExploded'));for(const a of game.actors)assert.ok(Number.isFinite(a.x+a.y+a.z)&&a.y>-.1);
});

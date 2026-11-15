import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {CollisionWorld,PLAYER,wrapAngle} from '../shared/world.mjs';
import {rifle} from './weapons.mjs';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
const renderer=new THREE.WebGLRenderer({canvas:$('game'),antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:params.has('capture')});
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
const scene=new THREE.Scene();scene.background=new THREE.Color(0xb7caca);scene.fog=new THREE.Fog(0xc6cfc4,55,140);
scene.add(new THREE.HemisphereLight(0xe6f3ff,0x817057,3));
const sun=new THREE.DirectionalLight(0xffedc8,2.6);sun.position.set(-35,60,28);scene.add(sun);
const camera=new THREE.PerspectiveCamera(76,innerWidth/innerHeight,.045,220);camera.rotation.order='YXZ';scene.add(camera);
const weapon=rifle();weapon.position.set(.23,-.24,-.48);weapon.rotation.set(.025,-.025,0);camera.add(weapon);weapon.visible=false;
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),avatars=new Map(),effects=[];
const tracerMaterial=new THREE.LineBasicMaterial({color:0xffd28c,transparent:true,opacity:.75});
const tracers=Array.from({length:16},()=>{const object=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),tracerMaterial);object.frustumCulled=false;object.visible=false;scene.add(object);return {object,until:0};});
const controls={forward:false,back:false,left:false,right:false,fire:false,reload:false,use:false,jump:false,yaw:0,pitch:0,seq:0};
let map,templates={},world,meta,snapshot,myId,playing=false,ready=false,worker,ws,mode='menu',localActor,online=false,acc=0,last=performance.now(),eventId=0,hitUntil=0,lastInput=0,ping=0,frameCount=0,frameSum=0,fps=0,lastFps=performance.now(),firstView=true;
let audio,hadPointerLock=false;const touch=matchMedia('(pointer:coarse)').matches;document.body.classList.toggle('touch',touch);
const status=t=>$('status').textContent=t;
const resize=()=>{const benchmark=params.has('benchmark'),width=benchmark?1280:innerWidth,height=benchmark?720:innerHeight;const ratio=benchmark?1:Math.min(devicePixelRatio||1,1.5,Math.sqrt(1500000/(width*height)));renderer.setPixelRatio(Math.max(.65,ratio));renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();};addEventListener('resize',resize);resize();
const decorate=root=>root.traverse(o=>{if(o.isMesh){o.frustumCulled=true;const materials=Array.isArray(o.material)?o.material:[o.material];for(const material of materials){material.metalness=0;material.forceSinglePass=true;material.roughness=Math.max(.72,material.roughness||0);if(material.map)material.map.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());}}});
async function load(){
 try{
  const [level,scarf,covered,collision,metadata]=await Promise.all([
   loader.loadAsync('/assets/models/sandstone.glb'),loader.loadAsync('/assets/models/operator-scarf.glb'),loader.loadAsync('/assets/models/operator-covered.glb'),
   fetch('/assets/maps/sandstone-collision.bin').then(r=>r.arrayBuffer()),fetch('/assets/maps/sandstone-navigation-meta.json').then(r=>r.json())]);
  for(const model of [scarf,covered])if(model.animations.length){const mixer=new THREE.AnimationMixer(model.scene);mixer.clipAction(model.animations[0]).play();mixer.update(.01);model.scene.updateMatrixWorld(true);}
  map=level.scene;decorate(map);map.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!/Decal/i.test(m.name)){m.transparent=false;m.alphaTest=.35;m.depthWrite=true;}else{m.depthWrite=false;m.polygonOffset=true;m.polygonOffsetFactor=-1;}}});scene.add(map);templates={blue:scarf,red:covered};meta=metadata;
  world=new CollisionWorld(new Float32Array(collision),{bounds:meta.bounds});
  makeSites();for(let i=0;i<2;i++){const a={id:'warm-'+i,team:i?'red':'blue',x:0,y:1,z:0},v=avatar(a);v.root.position.set(0,-100,0);}tracers[0].object.visible=true;weapon.visible=true;
  await renderer.compileAsync(scene,camera);tracers[0].object.visible=false;weapon.visible=false;for(const v of avatars.values())scene.remove(v.root);avatars.clear();
  ready=true;$('play').disabled=$('train').disabled=false;$('play').innerHTML='ИГРАТЬ ОНЛАЙН <span>↗</span>';
  status('Мир готов. Свободные места занимают боты.');
  if(params.has('benchmark'))start(false);
  if(params.has('capture'))setTimeout(capture,5000);
 }catch(e){status('Не удалось загрузить мир: '+e.message);console.error(e);}
}
function labelSprite(text,color){const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.font='bold 84px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,64,66);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));s.scale.set(1.8,1.8,1);return s;}
function makeSites(){for(const [key,p]of Object.entries(meta.sites)){const ring=new THREE.Mesh(new THREE.RingGeometry(2.25,2.38,48),new THREE.MeshBasicMaterial({color:0xe6d38c,transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.set(p.x,p.y+.025,p.z);scene.add(ring);const sign=labelSprite(key,'#efe1a6');sign.position.set(p.x,p.y+2.5,p.z);scene.add(sign);}}
function avatar(a){
 const root=new THREE.Group(),body=clone(templates[a.team].scene);decorate(body);root.add(body);scene.add(root);
 const bones={};body.traverse(o=>{if(o.isBone)bones[o.name]={bone:o,q:o.quaternion.clone()};});
 const gun=rifle();gun.position.set(.23,1.15,.2);gun.rotation.y=Math.PI;root.add(gun);
 const badge=new THREE.Mesh(new THREE.RingGeometry(.31,.36,24),new THREE.MeshBasicMaterial({color:a.team==='blue'?0x85c6eb:0xed9a77,transparent:true,opacity:.55,side:THREE.DoubleSide,depthWrite:false}));badge.rotation.x=-Math.PI/2;badge.position.y=.018;root.add(badge);
 const record={root,body,bones,gun,initialized:false,lastX:a.x,lastZ:a.z,phase:Math.random()*6};avatars.set(a.id,record);return record;
}
function animateBody(v,a,dt){
 const moving=Math.hypot(v.root.position.x-v.lastX,v.root.position.z-v.lastZ)>dt*.3&&a.walk;
 v.phase+=dt*(moving?9:1.4);const swing=moving?Math.sin(v.phase)*.42:Math.sin(v.phase)*.012;
 for(const [name,b]of Object.entries(v.bones)){
  b.bone.quaternion.copy(b.q);
  if(/leg_upper_L|LeftUpLeg/.test(name))b.bone.rotateX(swing);
  if(/leg_upper_R|RightUpLeg/.test(name))b.bone.rotateX(-swing);
  if(/leg_lower_L|LeftLeg/.test(name))b.bone.rotateX(Math.max(0,-swing)*.65);
  if(/leg_lower_R|RightLeg/.test(name))b.bone.rotateX(Math.max(0,swing)*.65);
  if(/spine_1_|Spine1/.test(name))b.bone.rotateX(Math.sin(v.phase)*.008);
 }
 v.lastX=v.root.position.x;v.lastZ=v.root.position.z;
}
function receive(data){
 if(data.type==='welcome'){myId=data.id;eventId=0;status('Комната готова');return;}
 if(data.type==='pong'){ping=Math.round(performance.now()-data.at);return;}
 if(data.type==='error'){status(data.message);return;}
 if(data.type!=='state')return;
 snapshot=data;const me=data.actors.find(a=>a.id===myId);
 if(me){
  if(!localActor||!me.alive||Math.hypot(localActor.x-me.x,localActor.z-me.z)>3||Math.abs(localActor.y-me.y)>2)localActor={...me};
  else{localActor.x+=(me.x-localActor.x)*.28;localActor.z+=(me.z-localActor.z)*.28;localActor.y+=(me.y-localActor.y)*.4;localActor.hp=me.hp;localActor.alive=me.alive;localActor.reload=me.reload;}
  if(firstView){controls.yaw=me.yaw;controls.pitch=me.pitch;firstView=false;}
 }
 for(const event of data.events||[]){if(event.id<=eventId)continue;eventId=event.id;handleEvent(event);}
 updateHud();
}
function disconnect(){if(ws){ws.onclose=null;ws.close();ws=null;}if(worker){worker.terminate();worker=null;}for(const v of avatars.values())scene.remove(v.root);avatars.clear();myId=null;localActor=null;snapshot=null;firstView=true;}
async function start(wantOnline){
 if(!ready)return;disconnect();playing=true;online=false;mode='loading';document.body.classList.add('playing');$('hud').hidden=false;weapon.visible=true;$('death').hidden=true;
 if(!touch&&!params.has('benchmark'))$('game').requestPointerLock?.()?.catch?.(()=>{});
 if(wantOnline){
  $('net').textContent='ПОДКЛЮЧЕНИЕ К КОМНАТЕ…';
  const config=await fetch('/config.json').then(r=>r.ok?r.json():{}).catch(()=>({}));
  const url=config.websocket||`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`;
  await new Promise(resolve=>{
   let settled=false;const done=success=>{if(settled)return;settled=true;if(!success){ws?.close();ws=null;}resolve(success);};
   try{ws=new WebSocket(url);ws.onopen=()=>{online=true;mode='online';ws.send(JSON.stringify({type:'name',name:$('nickname').value||'PLAYER'}));done(true);};ws.onmessage=e=>{try{receive(JSON.parse(e.data));}catch(error){console.error(error);}};ws.onerror=()=>done(false);ws.onclose=()=>{if(playing&&online){online=false;startLocal('СОЕДИНЕНИЕ ПРЕРВАНО · ТРЕНИРОВКА');}};}catch{done(false);}
   setTimeout(()=>done(false),8000);
  });
 }
 if(!online)startLocal(wantOnline?'СЕРВЕР ПРОСЫПАЕТСЯ · ТРЕНИРОВКА':'ТРЕНИРОВКА · ТЫ + 9 БОТОВ');
}
function startLocal(text){if(worker)worker.terminate();worker=new Worker('/training-worker.js',{type:'module'});worker.onmessage=e=>receive(e.data);worker.onerror=e=>{$('objective').textContent='Не удалось запустить тренировку: '+e.message;};worker.postMessage({type:'start',name:$('nickname').value||'PLAYER'});mode='training';$('net').textContent=text;}
$('play').onclick=()=>start(true);$('train').onclick=()=>start(false);
function menu(){playing=false;weapon.visible=false;document.exitPointerLock?.();document.body.classList.remove('playing');$('hud').hidden=true;for(const key of ['forward','back','left','right','fire','reload','use','jump'])controls[key]=false;}
$('pause').onclick=menu;
document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement)hadPointerLock=true;else if(hadPointerLock&&playing&&!params.has('benchmark')){hadPointerLock=false;menu();}});
const keys={KeyW:'forward',KeyS:'back',KeyA:'left',KeyD:'right',KeyR:'reload',KeyE:'use',Space:'jump'};
addEventListener('keydown',e=>{if(!playing)return;if(keys[e.code]){controls[keys[e.code]]=true;e.preventDefault();}if(e.code==='Escape')menu();});
addEventListener('keyup',e=>{if(keys[e.code])controls[keys[e.code]]=false;});
addEventListener('blur',()=>{for(const key of Object.values(keys))controls[key]=false;controls.fire=false;});
addEventListener('mousemove',e=>{if(playing&&document.pointerLockElement){controls.yaw=wrapAngle(controls.yaw-e.movementX*.0022);controls.pitch=THREE.MathUtils.clamp(controls.pitch-e.movementY*.0022,-1.45,1.45);}});
$('game').addEventListener('mousedown',e=>{if(playing&&e.button===0){controls.fire=true;if(!document.pointerLockElement&&!touch)$('game').requestPointerLock?.();}});addEventListener('mouseup',()=>controls.fire=false);addEventListener('contextmenu',e=>e.preventDefault());
for(const button of document.querySelectorAll('[data-action]')){button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);controls[button.dataset.action]=true;};button.onpointerup=button.onpointercancel=()=>controls[button.dataset.action]=false;}
let lookPoint=null,stickId=null;
$('look').onpointerdown=e=>{e.currentTarget.setPointerCapture(e.pointerId);lookPoint={x:e.clientX,y:e.clientY};};
$('look').onpointermove=e=>{if(!lookPoint)return;controls.yaw=wrapAngle(controls.yaw-(e.clientX-lookPoint.x)*.005);controls.pitch=THREE.MathUtils.clamp(controls.pitch-(e.clientY-lookPoint.y)*.005,-1.45,1.45);lookPoint={x:e.clientX,y:e.clientY};};$('look').onpointerup=$('look').onpointercancel=()=>lookPoint=null;
$('stick').onpointerdown=e=>{e.currentTarget.setPointerCapture(e.pointerId);stickId=e.pointerId;stickMove(e);};
function stickMove(e){if(stickId!==e.pointerId)return;const r=$('stick').getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2,m=Math.max(1,Math.hypot(x,y)/35);$('stick').firstElementChild.style.transform=`translate(${x/m}px,${y/m}px)`;controls.forward=y< -12;controls.back=y>12;controls.left=x< -12;controls.right=x>12;}
$('stick').onpointermove=stickMove;$('stick').onpointerup=$('stick').onpointercancel=()=>{stickId=null;$('stick').firstElementChild.style.transform='';controls.forward=controls.back=controls.left=controls.right=false;};
function handleEvent(e){
 if(e.type==='shot'){
  const a=snapshot.actors.find(a=>a.id===e.actorId);if(!a)return;
  const start=new THREE.Vector3(a.x,a.y+1.3,a.z),dir=new THREE.Vector3(-Math.sin(a.yaw)*Math.cos(a.pitch),Math.sin(a.pitch),-Math.cos(a.yaw)*Math.cos(a.pitch));
  const end=e.to?new THREE.Vector3(e.to.x,e.to.y,e.to.z):start.clone().addScaledVector(dir,Math.min(e.distance||35,70));
  const tracer=tracers.find(t=>t.until<performance.now())||tracers[0];tracer.object.geometry.attributes.position.setXYZ(0,start.x,start.y,start.z);tracer.object.geometry.attributes.position.setXYZ(1,end.x,end.y,end.z);tracer.object.geometry.attributes.position.needsUpdate=true;tracer.object.visible=true;tracer.until=performance.now()+55;
  const gun=e.actorId===myId?weapon:avatars.get(e.actorId)?.gun;if(gun){gun.userData.flash.visible=true;effects.push({flash:gun.userData.flash,left:.055});}
  sound(a,e.actorId===myId);
 }else if(e.type==='hit'&&e.attackerId===myId){hitUntil=performance.now()+160;}
}
function sound(a,own){
 if(!playing||!document.hasFocus()||params.has('benchmark'))return;
 try{audio??=new AudioContext();if(audio.state==='suspended')audio.resume();const source=audio.createBufferSource(),buffer=audio.createBuffer(1,Math.floor(audio.sampleRate*.07),audio.sampleRate),channel=buffer.getChannelData(0);for(let i=0;i<channel.length;i++)channel[i]=(Math.random()*2-1)*Math.exp(-i/channel.length*8);source.buffer=buffer;const gain=audio.createGain();gain.gain.value=own?.12:.04/(1+Math.hypot(a.x-camera.position.x,a.z-camera.position.z)/12);source.connect(gain).connect(audio.destination);source.start();}catch{}
}
function updateHud(){
 if(!snapshot)return;const s=snapshot,me=s.actors.find(a=>a.id===myId);$('blue-score').textContent=s.score.blue;$('red-score').textContent=s.score.red;
 const seconds=Math.ceil(s.bomb.status==='planted'?s.bomb.seconds:s.round.seconds);$('timer').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;$('timer').style.color=s.bomb.status==='planted'?'#ffb294':'';$('round').textContent='РАУНД '+s.round.number;
 if(online)$('net').textContent=`ОНЛАЙН · ${s.humans}/10 ИГРОКОВ · ${ping} MS`;
 if(me){$('hp').textContent=me.hp;$('ammo-value').textContent=me.ammo;$('weapon-state').textContent=me.reload>0?'ПЕРЕЗАРЯДКА…':'АВТОМАТ';$('death').hidden=me.alive;$('death').textContent=`ВОЗВРАЩЕНИЕ ЧЕРЕЗ ${Math.ceil(me.respawnIn)} СЕК.`;}
 let objective='';if(s.round.phase==='ended')objective=(s.round.winner==='blue'?'ЗАЩИТА':'АТАКА')+' ВЫИГРАЛА РАУНД';
 else if(s.bomb.status==='planted')objective=`БОМБА НА ${s.bomb.site} · ${Math.ceil(s.bomb.seconds)} СЕК.\n${s.bomb.defuseProgress>0?'ОБЕЗВРЕЖИВАНИЕ '+Math.round(s.bomb.defuseProgress*100)+'%':'ЗАЩИТА: УДЕРЖИВАЙ E РЯДОМ С БОМБОЙ'}`;
 else if(me?.carryingBomb)objective='У ТЕБЯ БОМБА · УДЕРЖИВАЙ E НА A ИЛИ B'+(s.bomb.plantProgress>0?'\nЗАКЛАДКА '+Math.round(s.bomb.plantProgress*100)+'%':'');
 $('objective').textContent=objective;
 const kills=(s.events||[]).filter(e=>e.type==='kill').slice(-4);$('feed').replaceChildren(...kills.map(e=>{const div=document.createElement('div');div.textContent=`${e.attacker||'—'}  ▸  ${e.victim||'—'}`;return div;}));
 radar();
}
function radar(){const ctx=$('radar').getContext('2d'),w=184,h=164;ctx.clearRect(0,0,w,h);ctx.fillStyle='#12221ed9';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#a9bd9522';for(let i=0;i<8;i++){ctx.beginPath();ctx.moveTo(i*w/7,0);ctx.lineTo(i*w/7,h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i*h/7);ctx.lineTo(w,i*h/7);ctx.stroke();}const project=p=>[(p.x+35)/70*w,(p.z+31)/62*h];for(const [key,p]of Object.entries(snapshot.sites)){const [x,y]=project(p);ctx.fillStyle='#d8d49e';ctx.font='bold 14px Arial';ctx.fillText(key,x-4,y+4);}for(const a of snapshot.actors){if(!a.alive)continue;const me=snapshot.actors.find(p=>p.id===myId);if(a.team!==me?.team)continue;const [x,y]=project(a);ctx.fillStyle=a.id===myId?'#e9ffb5':'#85c6eb';ctx.beginPath();ctx.arc(x,y,a.id===myId?3.5:2.5,0,Math.PI*2);ctx.fill();}}
async function capture(){renderer.render(scene,camera);const blob=await new Promise(r=>renderer.domElement.toBlob(r,'image/png'));if(blob)fetch('/api/capture',{method:'POST',headers:{'Content-Type':'image/png'},body:blob}).catch(()=>{});}
const bench={frames:[],started:0,invalid:0,done:false};
function frame(now){
 requestAnimationFrame(frame);const frameMs=now-last;let dt=Math.min(.05,frameMs/1000);last=now;
 frameCount++;frameSum+=frameMs/1000;if(now-lastFps>1000){fps=Math.round(frameCount/frameSum);$('performance').textContent=`${fps} FPS · ${renderer.info.render.calls} DRAW · ${Math.round(renderer.info.render.triangles/1000)}K TRI`;frameCount=0;frameSum=0;lastFps=now;}
 if(playing&&snapshot&&myId){
  if(now-lastInput>1000/30){controls.seq++;const packet={type:'input',...controls};if(online&&ws?.readyState===1)ws.send(JSON.stringify(packet));else worker?.postMessage(packet);lastInput=now;}
  const me=snapshot.actors.find(a=>a.id===myId);
  if(localActor&&me?.alive){localActor.yaw=controls.yaw;localActor.pitch=controls.pitch;world.move(localActor,controls,dt);}
  if(params.has('benchmark')){
   const follow=snapshot.actors.find(a=>a.bot&&a.alive);if(follow){camera.position.set(follow.x-Math.sin(follow.yaw)*-4,follow.y+2.4,follow.z-Math.cos(follow.yaw)*-4);camera.lookAt(follow.x,follow.y+1.2,follow.z);}
  }else if(localActor){camera.position.set(localActor.x,localActor.y+PLAYER.eye,localActor.z);camera.rotation.set(-controls.pitch,controls.yaw,0,'YXZ');}
  weapon.position.y=-.24+(controls.forward||controls.back||controls.left||controls.right?Math.sin(now*.012)*.007:Math.sin(now*.002)*.002);weapon.rotation.z=me?.reload>0?-.5:0;weapon.visible=!!me?.alive&&!params.has('benchmark');
 }else{
  const t=now*.000025;camera.position.set(35+Math.sin(t)*5,23,34+Math.cos(t)*6);camera.lookAt(2,2,0);weapon.visible=false;
 }
 if(snapshot){const ids=new Set();for(const a of snapshot.actors){ids.add(a.id);const v=avatars.get(a.id)||avatar(a);v.root.visible=a.alive&&(a.id!==myId||params.has('benchmark'));const alpha=v.initialized?1-Math.exp(-dt*17):1;v.root.position.lerp(new THREE.Vector3(a.x,a.y,a.z),alpha);v.root.rotation.y+=wrapAngle(a.yaw+Math.PI-v.root.rotation.y)*alpha;v.initialized=true;animateBody(v,a,dt);}for(const [id,v]of avatars)if(!ids.has(id)){scene.remove(v.root);avatars.delete(id);}}
 for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.left-=dt;if(e.left<=0){if(e.flash)e.flash.visible=false;if(e.object){scene.remove(e.object);e.object.geometry.dispose();e.object.material.dispose();}effects.splice(i,1);}}
 for(const tracer of tracers)if(tracer.until<now)tracer.object.visible=false;
 $('hitmarker').style.opacity=now<hitUntil?'1':'0';renderer.render(scene,camera);
 if(online&&ws?.readyState===1&&Math.floor(now/3000)!==Math.floor((now-dt*1000)/3000))ws.send(JSON.stringify({type:'ping',at:now}));
 if(params.has('benchmark')&&snapshot&&!bench.done){
  bench.started||=now;if(now-bench.started>5000){if(document.hidden||!document.hasFocus())bench.invalid++;else bench.frames.push(frameMs);}
  if(now-bench.started>Number(params.get('seconds')||60)*1000+5000){bench.done=true;const f=bench.frames.slice().sort((a,b)=>b-a),slow=f.slice(0,Math.max(1,Math.ceil(f.length*.01)));const result={type:'contra-gameplay',date:new Date().toISOString(),frames:f.length,avgFPS:1000/(f.reduce((a,b)=>a+b,0)/f.length),low1FPS:1000/(slow.reduce((a,b)=>a+b,0)/slow.length),invalidFrames:bench.invalid,viewport:[innerWidth,innerHeight],drawingBuffer:[renderer.domElement.width,renderer.domElement.height],renderer:renderer.info.render,actors:snapshot.actors.length,bots:snapshot.actors.filter(a=>a.bot).length,tick:snapshot.tick,userAgent:navigator.userAgent};console.log('CONTRA_BENCHMARK',result);fetch('/api/benchmark',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)}).catch(()=>{});$('objective').textContent=`ЗАМЕР ЗАВЕРШЁН · ${result.avgFPS.toFixed(1)} FPS · 1% ${result.low1FPS.toFixed(1)}`;capture();}
 }
}
requestAnimationFrame(frame);load();

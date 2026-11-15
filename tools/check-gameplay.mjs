import {loadGameAssets} from '../server/app.mjs';
import {createGame} from '../shared/game.mjs';
const {world,navigation}=await loadGameAssets();
const game=createGame({world,navigation});
const start=performance.now(),events=new Map(),positions=game.actors.map(a=>({id:a.id,x:a.x,y:a.y,z:a.z}));
for(let i=0;i<30*240;i++){game.step(1/30);for(const e of game.snapshot().events)events.set(e.id,e);}
const counts={};for(const e of events.values())counts[e.type]=(counts[e.type]||0)+1;
console.log(JSON.stringify({seconds:game.time,cpuMs:performance.now()-start,counts,actors:game.actors.map(a=>({id:a.id,x:a.x,y:a.y,z:a.z,stuck:a.stuck,kills:a.kills,alive:a.alive,distanceFromSpawn:Math.hypot(a.x-positions.find(p=>p.id===a.id).x,a.z-positions.find(p=>p.id===a.id).z)})),bomb:game.bomb},null,2));

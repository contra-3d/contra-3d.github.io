import {init,importNavMesh,NavMeshQuery} from '@recast-navigation/core';
import {CollisionWorld} from '../shared/world.mjs';
import {createGame} from '../shared/game.mjs';
let game,id,interval;
onmessage=async({data})=>{
 try {
  if(data.type==='start'){
   clearInterval(interval);
   const [collision,nav,meta]=await Promise.all([fetch('/assets/maps/sandstone-collision.bin').then(r=>r.arrayBuffer()),fetch('/assets/maps/sandstone-nav.bin').then(r=>r.arrayBuffer()),fetch('/assets/maps/sandstone-navigation-meta.json').then(r=>r.json())]);
   await init();const {navMesh}=importNavMesh(new Uint8Array(nav)),query=new NavMeshQuery(navMesh,{maxNodes:8192});
   query.defaultQueryHalfExtents={x:3,y:2,z:3};
   const navigation={...meta,nearestPoint(p){const r=query.findClosestPoint(p);return r.success?r.point:null;},findPath(a,b){const r=query.computePath(a,b);return r.success?r.path:[];}};
   game=createGame({world:new CollisionWorld(new Float32Array(collision),{bounds:meta.bounds}),navigation});
   id=game.join(data.name).id;postMessage({type:'welcome',id,room:'training'});
   interval=setInterval(()=>{game.step(1/30);if(game.tick%2===0)postMessage({type:'state',...game.snapshot()});},1000/30);
  }else if(data.type==='input')game?.input(id,data);
 }catch(error){postMessage({type:'error',message:error.message});}
};

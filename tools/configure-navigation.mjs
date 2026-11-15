import fs from 'node:fs/promises';
import {init,importNavMesh,NavMeshQuery} from '@recast-navigation/core';
await init();
const dir=new URL('../public/assets/maps/',import.meta.url);
const {navMesh}=importNavMesh(await fs.readFile(new URL('sandstone-nav.bin',dir)));
const query=new NavMeshQuery(navMesh,{maxNodes:8192});
query.defaultQueryHalfExtents={x:5,y:2,z:5};
const closest=p=>{const r=query.findClosestPoint(p);return r.success?r.point:null;};
const candidates=[];
for(let z=-23;z<=23;z+=2)for(let x=-23;x<=23;x+=2){let p=closest({x,y:1.7,z});if(p&&p.y<3.4&&Math.hypot(p.x-x,p.z-z)<.6)candidates.push(p);}
const connected=(a,b)=>{const r=query.computePath(a,b);return r.success&&r.path.length&&Math.hypot(r.path.at(-1).x-b.x,r.path.at(-1).z-b.z)<.7?r.path:null;};
let largest=[];
for(const anchor of candidates.filter((_,i)=>i%15===0)){const set=candidates.filter(p=>connected(anchor,p));if(set.length>largest.length)largest=set;}
if(largest.length<20)throw Error('No connected playable area');
const target=p=>largest.reduce((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)<Math.hypot(b.x-p.x,b.z-p.z)?a:b);
const blue=target({x:-15,z:15}),red=target({x:15,z:-15});
const spread=p=>{const points=[p];const sorted=largest.slice().sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z));for(const q of sorted){if(points.every(v=>Math.hypot(v.x-q.x,v.z-q.z)>.9)&&Math.abs(q.y-p.y)<.5)points.push(q);if(points.length===5)break;}if(points.length!==5)throw Error('No room for five distinct spawns');return points;};
const meta={coordinates:'Y-up metres',spawns:{blue:spread(blue),red:spread(red)},sites:{A:target({x:-15,z:-13}),B:target({x:15,z:13})},bounds:{minX:-35,maxX:35,minZ:-31,maxZ:31,minY:-12,maxY:30},connectedSamples:largest.length};
for(const [name,p]of Object.entries({...meta.sites,blue,red}))console.log(name,p,'path fromblue',connected(blue,p)?.length);
await fs.writeFile(new URL('sandstone-navigation-meta.json',dir),JSON.stringify(meta,null,2));
navMesh.destroy();

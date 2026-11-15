import fs from 'node:fs/promises';
import {init,importNavMesh,NavMeshQuery} from '@recast-navigation/core';
export async function loadNavigation(){
  await init();
  const dir=new URL('../public/assets/maps/',import.meta.url);
  const [data,metadata]=await Promise.all([fs.readFile(new URL('sandstone-nav.bin',dir)),fs.readFile(new URL('sandstone-navigation-meta.json',dir),'utf8')]);
  const {navMesh}=importNavMesh(data),query=new NavMeshQuery(navMesh,{maxNodes:8192});
  query.defaultQueryHalfExtents={x:3,y:2,z:3};
  return {...JSON.parse(metadata),nearestPoint(point){const r=query.findClosestPoint(point);return r.success?r.point:null;},findPath(a,b){const r=query.computePath(a,b);return r.success?r.path:[];},dispose(){navMesh.destroy();}};
}

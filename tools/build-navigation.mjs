import fs from 'node:fs/promises';
import { init, exportNavMesh, getNavMeshPositionsAndIndices, NavMeshQuery } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';
await init();
const dir = new URL('../public/assets/maps/', import.meta.url);
const bytes = await fs.readFile(new URL('sandstone-collision.bin', dir));
const positions = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const indices = Uint32Array.from({length: positions.length / 3}, (_, i) => i);
const config = { cs: .16, ch: .08, walkableSlopeAngle: 44, walkableHeight: 23, walkableClimb: 4, walkableRadius: 3,
  maxEdgeLen: 60, maxSimplificationError: 1.1, minRegionArea: 18, mergeRegionArea: 100,
  maxVertsPerPoly: 6, detailSampleDist: 6, detailSampleMaxError: 1,
  bounds: [[-35, -.3, -31], [35, 13, 31]] };
const result = generateSoloNavMesh(positions, indices, config);
if (!result.success) throw new Error(result.error);
await fs.writeFile(new URL('sandstone-nav.bin', dir), exportNavMesh(result.navMesh));
const [p, ix] = getNavMeshPositionsAndIndices(result.navMesh);
await fs.writeFile(new URL('sandstone-nav-debug.json', dir), JSON.stringify({positions:p, indices:ix}));
const query = new NavMeshQuery(result.navMesh, {maxNodes: 8192});
query.defaultQueryHalfExtents = {x: 3,y: 3,z: 3};
const samples = [];
for(let z=-29;z<=29;z+=2) for(let x=-33;x<=33;x+=2) {
  const r = query.findClosestPoint({x,y:1.5,z});
  if(r.success && Math.hypot(r.point.x-x,r.point.z-z)<.5 && r.point.y<4) samples.push(r.point);
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="992" viewBox="-35 -31 70 62"><rect x="-35" y="-31" width="70" height="62" fill="#101a24"/>${Array.from({length:ix.length/3},(_,i)=>{const ids=ix.slice(i*3,i*3+3); const h=ids.reduce((s,n)=>s+p[n*3+1],0)/3;return `<polygon points="${ids.map(n=>`${p[n*3]},${p[n*3+2]}`).join(' ')}" fill="hsl(${180-h*22} 55% ${30+h*3}%)" stroke="#10202c" stroke-width=".025"/>`;}).join('')}${samples.map(q=>`<text x="${q.x}" y="${q.z}" fill="white" font-size=".45">${Math.round(q.x)},${Math.round(q.z)}:${q.y.toFixed(1)}</text>`).join('')}</svg>`;
await fs.writeFile(new URL('../art/nav-topdown.svg', import.meta.url),svg);
const {default:sharp} = await import('sharp');
await sharp(Buffer.from(svg)).png().toFile(new URL('../art/nav-topdown.png', import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'));
console.log(JSON.stringify({triangles:ix.length/3,vertices:p.length/3,samples:samples.length,config}));
result.navMesh.destroy();

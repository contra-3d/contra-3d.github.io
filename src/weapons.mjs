import * as THREE from 'three';
const metal=new THREE.MeshStandardMaterial({color:0x30353a,roughness:.42,metalness:.72});
const dark=new THREE.MeshStandardMaterial({color:0x171b1e,roughness:.8,metalness:.1});
const wood=new THREE.MeshStandardMaterial({color:0x865335,roughness:.72});
export function rifle(){
 const group=new THREE.Group();
 const box=(x,y,z,w,h,d,m)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);mesh.position.set(x,y,z);group.add(mesh);return mesh;};
 box(0,0,0,.065,.105,.36,metal);box(0,.064,-.02,.043,.022,.32,metal);
 box(0,-.025,.26,.055,.11,.26,wood);box(0,.01,-.27,.075,.10,.21,wood);
 box(0,-.12,.08,.05,.16,.07,dark).rotation.x=-.3;
 box(0,-.15,-.07,.05,.21,.085,dark).rotation.x=.22;
 box(0,.11,-.38,.012,.075,.02,metal);box(0,.09,.11,.03,.03,.04,metal);
 const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.28,10),metal);barrel.rotation.x=Math.PI/2;barrel.position.set(0,.015,-.49);group.add(barrel);
 const tube=new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.18,10),metal);tube.rotation.x=Math.PI/2;tube.position.set(0,.065,-.32);group.add(tube);
 const flash=new THREE.Mesh(new THREE.ConeGeometry(.055,.18,5),new THREE.MeshBasicMaterial({color:0xffd28a,transparent:true,opacity:.9}));flash.rotation.x=-Math.PI/2;flash.position.set(0,.014,-.7);flash.visible=false;group.add(flash);group.userData.flash=flash;
 return group;
}

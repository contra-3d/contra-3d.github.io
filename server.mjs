import {createContraServer} from './server/app.mjs';
const app=await createContraServer({publicDir:new URL('./dist/web',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1')});
await app.start();
console.log(`Contra ready: http://localhost:${process.env.PORT||8766} (navigation: ${app.ready})`);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await app.close();process.exit(0);});

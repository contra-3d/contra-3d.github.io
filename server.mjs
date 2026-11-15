import {createContraServer} from './server/app.mjs';
const app=await createContraServer({publicDir:new URL('./dist/web',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1')});
await app.start();
console.log(`Contra ready: http://localhost:${process.env.PORT||8766} (navigation: ${app.ready})`);
console.log(`Memory after map load: ${Math.round(process.memoryUsage().rss/1048576)} MiB RSS, ${Math.round(process.memoryUsage().heapUsed/1048576)} MiB JS heap`);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await app.close();process.exit(0);});

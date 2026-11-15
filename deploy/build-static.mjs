// Compatibility entry for the build command cached by the existing Render site.
import {execFileSync} from 'node:child_process';
execFileSync(process.platform==='win32'?'npx.cmd':'npx',['--yes','pnpm@11.25.0','install','--frozen-lockfile','--prod=false'],{stdio:'inherit'});
await import('../tools/build-web.mjs');

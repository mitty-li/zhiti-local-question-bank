import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
/** Compile repository source, not user/model content. No filesystem artifacts. */
export async function loadSource(file){
  const result=await build({entryPoints:[file],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',logLevel:'silent'});
  const module={exports:{}};
  new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
  return module.exports;
}

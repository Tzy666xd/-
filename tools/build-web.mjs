// 零构建打包：内核和界面都写 .ts，Node 能直接跑（自检用），浏览器不行。
// 这里用 Node 自带的 stripTypeScriptTypes 把类型擦掉，产物是普通 ES module——
// 不引入 tsc、不装任何包，所以这条链子在别的机器上也一样能跑。
// 代价：源码里不许用 enum / namespace / 参数属性，跨文件的类型必须写 `import type`。
import { stripTypeScriptTypes } from 'node:module';
import { readdirSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'web', 'gen');
const quiet = process.argv.includes('--quiet');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'core'), { recursive: true });

function emit(src, dest) {
  const code = readFileSync(src, 'utf8');
  // 类型擦除后把说明符改写成浏览器能取的路径：
  //   web/main.ts 里的 '../core/x.ts' 落到 gen/core/x.js
  //   core/*.ts 之间的 './x.ts' 留在同目录
  const js = stripTypeScriptTypes(code, { mode: 'strip' })
    .replace(/(\bfrom\s*['"])\.\.\/core\/([\w.-]+)\.ts(['"])/g, '$1./core/$2.js$3')
    .replace(/(\bfrom\s*['"])\.\/core\/([\w.-]+)\.ts(['"])/g, '$1./core/$2.js$3')
    .replace(/(\bfrom\s*['"])\.\/([\w.-]+)\.ts(['"])/g, '$1./$2.js$3');
  writeFileSync(dest, js);
  return js.length;
}

let files = 0;
for (const f of readdirSync(join(root, 'core'))) {
  // selftest 与 sim 是开发期工具，不进产物
  if (!f.endsWith('.ts') || f === 'selftest.ts' || f === 'sim.ts' || f === 'fuzz.ts') continue;
  emit(join(root, 'core', f), join(outDir, 'core', basename(f, '.ts') + '.js'));
  files++;
}
for (const f of readdirSync(join(root, 'web'))) {
  if (!f.endsWith('.ts')) continue;
  const p = join(root, 'web', f);
  if (statSync(p).isDirectory()) continue;
  emit(p, join(outDir, basename(f, '.ts') + '.js'));
  files++;
}
// gen/ 只放擦过类型的 JS；index.html 与 styles.css 留在 web/ 原位被引用，
// 免得同一份 CSS 出现两个副本、各自漂移。
// 顺手同步进已存在的 .app：App 读的是包内副本，只写 web/gen/ 会让人误测旧产物
// （踩过：改了探针却量不到，因为包里还是上一版 main.js）。
const appWeb = join(root, 'dist', '几尼.app', 'Contents', 'Resources', 'web');
let synced = false;
if (existsSync(appWeb)) {
  rmSync(appWeb, { recursive: true, force: true });
  mkdirSync(appWeb, { recursive: true });
  cpSync(join(root, 'web', 'index.html'), join(appWeb, 'index.html'));
  cpSync(join(root, 'web', 'styles.css'), join(appWeb, 'styles.css'));
  cpSync(outDir, join(appWeb, 'gen'), { recursive: true });
  synced = true;
}
if (!quiet) console.log(`BUILD WEB OK  ${files} 个模块 → web/gen/${synced ? ' + 已同步进 dist/几尼.app' : ''}`);

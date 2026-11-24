import { access, cp, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const source = resolve('dist');
const output = process.argv[2] && resolve(process.argv[2]);
const full = 'https://guanghe-dark-vault.fc545123.chatgpt.site/';
const backup = 'https://guanghe-dark-vault-preview-nov23.pages.dev/';
const fromSource = output && relative(source, output);
if (!fromSource || !(isAbsolute(fromSource) || fromSource === '..' || fromSource.startsWith('..' + sep))) {
  throw new Error('Pass a fresh output directory outside dist.');
}
if (await access(output, constants.F_OK).then(() => true, () => false)) {
  throw new Error('Output already exists; use a fresh publishing directory.');
}
await cp(source, output, {
  recursive: true,
  filter: path => !['server', '.openai', 'community.js', 'online.js'].includes(relative(source, path)),
});

function replaceRequired(content, pattern, value) {
  const result = content.replace(pattern, value);
  if (result === content) throw new Error('Pages adapter could not find ' + pattern);
  return result;
}

const htmlPath = join(output, 'index.html');
let html = await readFile(htmlPath, 'utf8');
html = replaceRequired(html, /\s*<script src="community\.js\?[^"]+" defer><\/script>\s*<script src="online\.js\?[^"]+" defer><\/script>/, '');
html = replaceRequired(html, '</head>', '  <link rel="stylesheet" href="pages.css?v=25">\n</head>');
html = replaceRequired(html, '<main id="main" tabindex="-1" class="shell">', `<main id="main" tabindex="-1" class="shell">
    <aside class="pages-services" aria-label="试玩版本">
      <span>GitHub 单人试玩 · 游客进度保存在当前浏览器</span>
      <div class="pages-online-links">
        <a class="text-button" href="${full}#online">真人联机</a>
        <a class="text-button" href="${full}#account">账号存档</a>
        <a class="text-button" href="${backup}#online" title="备用测试站使用独立账号与房间">备用联机站</a>
      </div>
    </aside>`);
html = replaceRequired(html, 'data-nav="account" id="account-link">登录', 'id="account-link">账号');
for (const route of ['online', 'account']) {
  const link = new RegExp(`href="#${route}"(?: data-nav="${route}")?`, 'g');
  html = replaceRequired(html, link, `href="${full}#${route}"`);
}
html = replaceRequired(html, '<div id="battle-discussions"></div>',
  `<div id="battle-discussions" class="pages-services"><strong>查看公开战报和玩家回复</strong>
  <a class="button subtle small" href="${full}#community">前往在线交流站</a></div>`);
html = replaceRequired(html, '<div id="online-board"></div>',
  `<div id="online-board" class="pages-services"><span>和朋友使用同一个站点的邀请链接。</span><a class="button primary" href="${full}#online">前往真人竞拍</a>
  <a class="button subtle" href="${backup}#online">备用联机站</a></div>`);
html = replaceRequired(html, '<article class="panel account-panel">',
  `<article class="panel account-panel"><p>GitHub 游客档保存在这个浏览器。登录账号可在完整站换设备继续。</p><a class="button primary" href="${full}#account">前往在线账号</a>`);
await writeFile(htmlPath, html);

const appPath = join(output, 'app.js');
let app = (await readFile(appPath, 'utf8')).replace(/\r\n/g, '\n');
app = replaceRequired(app, 'void syncAccount().then(tick);\n  window.setInterval(tick, 1000);',
  'void tick();\n  window.setInterval(tick, 1000);');
await writeFile(appPath, app);

await writeFile(join(output, 'pages.css'), `
.pages-services {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 6px 14px; padding: 7px 11px; margin-block: 8px 10px; font-size: 13px;
  color: var(--text); background: var(--tinted); border-inline-start: 3px solid var(--blue);
}
.pages-services a { color: var(--blue); font-weight: 700; }
.pages-online-links { display: flex; flex-wrap: wrap; gap: 6px 14px; }
#account-guest, #account-signed-in, #account-status, #save-scope,
.battle-hook, [data-action="discuss-report"] { display: none; }
`);
await writeFile(join(output, '.nojekyll'), '');
console.log(output);

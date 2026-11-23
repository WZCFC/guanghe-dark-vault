import { access, cp, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const source = resolve('dist');
const output = process.argv[2] && resolve(process.argv[2]);
const full = 'https://guanghe-dark-vault.fc545123.chatgpt.site/';
if (!output || relative(source, output) === '' || !relative(source, output).startsWith('..')) {
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
      <span>GitHub 试玩 · 单人进度保存在当前浏览器</span>
      <a class="text-button" href="${full}">完整在线版</a>
    </aside>`);
html = replaceRequired(html, 'data-nav="account" id="account-link">登录', 'id="account-link">在线账号');
for (const route of ['online', 'account', 'feedback']) {
  const link = new RegExp(`href="#${route}"(?: data-nav="${route}")?`, 'g');
  html = replaceRequired(html, link, `href="${full}#${route}"`);
}
html = replaceRequired(html, '<div id="battle-discussions"></div>',
  `<div id="battle-discussions" class="pages-services"><strong>查看公开战报和玩家回复</strong>
  <a class="button subtle small" href="${full}#community">前往在线交流站</a></div>`);
html = replaceRequired(html, '<div id="online-board"></div>',
  `<div id="online-board" class="pages-services"><a class="button primary" href="${full}#online">前往真人竞拍</a></div>`);
html = replaceRequired(html, '<article class="panel account-panel">',
  `<article class="panel account-panel"><a class="button primary" href="${full}#account">前往在线账号</a>`);
html = replaceRequired(html, '<article class="panel survey-panel">',
  `<article class="panel survey-panel"><div class="pages-services"><a class="button primary" href="${full}#feedback">打开在线问卷</a></div>`);
await writeFile(htmlPath, html);

const appPath = join(output, 'app.js');
let app = (await readFile(appPath, 'utf8')).replace(/\r\n/g, '\n');
app = replaceRequired(app, 'void syncAccount().then(tick);\n  window.setInterval(tick, 1000);',
  'void tick();\n  window.setInterval(tick, 1000);');
await writeFile(appPath, app);

const viewsPath = join(output, 'views.js');
let views = await readFile(viewsPath, 'utf8');
views = replaceRequired(views, 'href="#feedback" data-nav="feedback"', `href="${full}#feedback"`);
await writeFile(viewsPath, views);

await writeFile(join(output, 'pages.css'), `
.pages-services {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 6px 14px; padding: 7px 11px; margin-block: 8px 10px; font-size: 13px;
  color: var(--text); background: var(--tinted); border-inline-start: 3px solid var(--blue);
}
.pages-services a { color: var(--blue); font-weight: 700; }
#account-guest, #account-signed-in, #account-status, #save-scope, #experience-survey,
.battle-hook, [data-action="discuss-report"] { display: none; }
`);
await writeFile(join(output, '.nojekyll'), '');
console.log(output);

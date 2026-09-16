/**
 * Utilitários compartilhados pelos testes automatizados do Conta Aí:
 * sobe um servidor estático local servindo o index.html real, abre num
 * Chromium headless com um SDK do Firebase falso (nenhuma chamada de
 * rede/Firestore acontece) e dá um runner minimalista de testes.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (filePath.endsWith('/')) filePath = path.join(filePath, 'index.html');
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        const ext = path.extname(filePath);
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Em alguns ambientes o Chromium instalado fica em caminho fixo em vez do
// padrão do Playwright (versão diferente da baixada por "npx playwright
// install") — usa esse caminho só quando ele existir.
async function launchBrowser() {
  const chromiumFixo = '/opt/pw-browsers/chromium';
  return chromium.launch(fs.existsSync(chromiumFixo) ? { executablePath: chromiumFixo } : {});
}

// SDK do Firebase totalmente falso: nenhuma leitura/gravação real acontece,
// nada sai da máquina local. Suficiente para as funções do app rodarem.
async function mockFirebase(page) {
  await page.addInitScript(() => {
    function chain() {
      const obj = {};
      obj.collection = () => chain();
      obj.doc = () => chain();
      obj.get = async () => ({ exists: false, data: () => ({}) });
      obj.set = async () => {};
      obj.update = async () => {};
      obj.delete = async () => {};
      obj.onSnapshot = () => () => {};
      obj.batch = () => ({ set(){}, delete(){}, commit: async () => {} });
      obj.settings = () => {};
      return obj;
    }
    window.firebase = {
      initializeApp: () => ({}),
      app: () => ({}),
      firestore: () => chain(),
      auth: () => ({
        setPersistence: async () => {},
        onAuthStateChanged: () => () => {},
        signOut: async () => {},
        currentUser: { email: 'teste@example.com' },
      }),
    };
    window.firebase.auth.Auth = { Persistence: { LOCAL: 'local' } };
  });
  await page.route('**/*gstatic.com/**', (route) => route.abort());
}

// Abre o app já "logado" com um usuário e listas vazias, pronto para os testes.
async function newPage(browser, baseUrl) {
  const page = await browser.newPage();
  await mockFirebase(page);
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.getElementById('loading-overlay').style.display = 'none';
    currentUID = 'testuid';
    users.push({ name: 'Ana', color: '#e84e9c' });
    currentUser = 'Ana';
    ensureCurrentUser();
    LISTAS.forEach((l) => (DB[l] = []));
  });
  return page;
}

// ── Runner minimalista (sem dependências além do playwright) ────────────────
function makeRunner() {
  const results = [];
  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  ✓ ${name}`);
    } catch (e) {
      results.push({ name, ok: false, error: e.message });
      console.log(`  ✗ ${name}`);
      console.log(`    ${e.message}`);
    }
  }
  function report() {
    const falhas = results.filter((r) => !r.ok);
    console.log(`\n${results.length - falhas.length}/${results.length} testes passaram.`);
    if (falhas.length) {
      console.log('\nFalharam:');
      falhas.forEach((f) => console.log(`  - ${f.name}: ${f.error}`));
    }
    return falhas.length === 0;
  }
  return { test, report };
}

module.exports = { startServer, launchBrowser, mockFirebase, newPage, makeRunner };

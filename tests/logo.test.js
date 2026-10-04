#!/usr/bin/env node
/**
 * Testes do logo "Conta Aí" (ícone + nome) — deve aparecer na tela de
 * login e no cabeçalho depois de logado.
 */

const assert = require('assert');
const { startServer, launchBrowser, mockFirebase, newPage } = require('./helpers');

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();
  const { test, report } = require('./helpers').makeRunner();

  console.log('Logo "Conta Aí" — Conta Aí\n');

  await test('a tela de login mostra o ícone e o nome "Conta Aí"', async () => {
    const page = await browser.newPage();
    await mockFirebase(page);
    await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => showLoginScreen());
    const iconVisivel = await page.locator('#setup-screen .auth-logo-svg').isVisible();
    const nomeTexto = await page.locator('#setup-screen .auth-logo-name').innerText();
    assert.strictEqual(iconVisivel, true, 'o ícone não deveria estar escondido');
    assert.strictEqual(nomeTexto.replace(/\s+/g, ' ').trim(), 'Conta Aí');
    await page.close();
  });

  await test('o cabeçalho depois de logado mostra o ícone ao lado do nome', async () => {
    const page = await newPage(browser, baseUrl);
    const iconCount = await page.locator('.logo-wrap svg').count();
    assert.strictEqual(iconCount, 1);
    await page.close();
  });

  await browser.close();
  server.close();

  const ok = report();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('Erro ao rodar os testes:', e);
  process.exit(1);
});

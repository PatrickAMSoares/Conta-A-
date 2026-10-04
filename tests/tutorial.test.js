#!/usr/bin/env node
/**
 * Testes do tutorial de primeiro acesso — um carrossel de passos que
 * aparece sozinho na primeira vez que a pessoa entra (quando "tutorialVisto"
 * ainda não está salvo nas preferências do plano) e pode ser revisto a
 * qualquer momento em Configurações → Tutorial.
 */

const assert = require('assert');
const { startServer, launchBrowser, newPage, makeRunner } = require('./helpers');

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();
  const { test, report } = makeRunner();

  console.log('Tutorial de primeiro acesso — Conta Aí\n');

  await test('abrirTutorial mostra o primeiro passo com os botões certos', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => abrirTutorial());
    const aberto = await page.locator('#modal-tutorial').evaluate((el) => el.classList.contains('open'));
    const titulo = await page.locator('#tutorial-conteudo h3').innerText();
    const voltarVisivel = await page.locator('#tutorial-voltar').isVisible();
    assert.strictEqual(aberto, true);
    assert.strictEqual(titulo, 'Bem-vindo ao Conta Aí!');
    assert.strictEqual(voltarVisivel, false, 'não deveria ter "Voltar" no primeiro passo');
    await page.close();
  });

  await test('tutorialProximo avança os passos e mostra "Voltar" a partir do segundo', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => abrirTutorial());
    await page.evaluate(() => tutorialProximo());
    const titulo = await page.locator('#tutorial-conteudo h3').innerText();
    const voltarVisivel = await page.locator('#tutorial-voltar').isVisible();
    assert.strictEqual(titulo, 'Lance suas despesas');
    assert.strictEqual(voltarVisivel, true);
    await page.close();
  });

  await test('tutorialAnterior volta um passo', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { abrirTutorial(); tutorialProximo(); tutorialProximo(); });
    await page.evaluate(() => tutorialAnterior());
    const titulo = await page.locator('#tutorial-conteudo h3').innerText();
    assert.strictEqual(titulo, 'Lance suas despesas');
    await page.close();
  });

  await test('os pontinhos mostram o passo atual como ativo', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { abrirTutorial(); tutorialProximo(); });
    const ativo = await page.evaluate(() => Array.from(document.querySelectorAll('.tutorial-dot')).findIndex((d) => d.classList.contains('ativo')));
    assert.strictEqual(ativo, 1);
    await page.close();
  });

  await test('no último passo o botão vira "Vamos lá!" e some o "Pular"', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      abrirTutorial();
      for (let i = 0; i < 10; i++) tutorialProximo();
    });
    const textoBotao = await page.locator('#tutorial-proximo').innerText();
    const pularVisivel = await page.locator('#tutorial-pular').isVisible();
    assert.ok(textoBotao.includes('Vamos lá'));
    assert.strictEqual(pularVisivel, false);
    await page.close();
  });

  await test('clicar em "Vamos lá!" no último passo fecha o modal e marca como visto', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      abrirTutorial();
      for (let i = 0; i < 10; i++) tutorialProximo();
    });
    await page.evaluate(() => tutorialProximo());
    const aberto = await page.locator('#modal-tutorial').evaluate((el) => el.classList.contains('open'));
    const visto = await page.evaluate(() => tutorialVisto);
    assert.strictEqual(aberto, false);
    assert.strictEqual(visto, true);
    await page.close();
  });

  await test('pularTutorial fecha o modal e também marca como visto', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => abrirTutorial());
    await page.evaluate(() => pularTutorial());
    const aberto = await page.locator('#modal-tutorial').evaluate((el) => el.classList.contains('open'));
    const visto = await page.evaluate(() => tutorialVisto);
    assert.strictEqual(aberto, false);
    assert.strictEqual(visto, true);
    await page.close();
  });

  await test('clicar fora do modal do tutorial não fecha (precisa usar os botões)', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => abrirTutorial());
    await page.locator('#modal-tutorial').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(100);
    const aberto = await page.locator('#modal-tutorial').evaluate((el) => el.classList.contains('open'));
    assert.strictEqual(aberto, true);
    await page.close();
  });

  await test('tutorialVisto entra na persistência (o que a sincronização com o Firestore grava)', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { abrirTutorial(); pularTutorial(); });
    const salvo = await page.evaluate(() => getPrefs().tutorialVisto);
    assert.strictEqual(salvo, true);
    await page.close();
  });

  await test('applyPrefs restaura tutorialVisto (ex.: ao reabrir o app)', async () => {
    const page = await newPage(browser, baseUrl);
    const visto = await page.evaluate(() => {
      applyPrefs({ theme: 'dark', tutorialVisto: true });
      return tutorialVisto;
    });
    assert.strictEqual(visto, true);
    await page.close();
  });

  await test('a linha "Tutorial" em Configurações reabre o tutorial do início', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { tutorialVisto = true; openModal('settings'); });
    await page.click('#modal-settings >> text=Tutorial');
    const aberto = await page.locator('#modal-tutorial').evaluate((el) => el.classList.contains('open'));
    const titulo = await page.locator('#tutorial-conteudo h3').innerText();
    assert.strictEqual(aberto, true);
    assert.strictEqual(titulo, 'Bem-vindo ao Conta Aí!');
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

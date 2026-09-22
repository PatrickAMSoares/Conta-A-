#!/usr/bin/env node
/**
 * Testes do vencimento único por cartão: ao criar um cartão, define-se o
 * dia de vencimento; ao escolher esse cartão numa Despesa Variável nova,
 * a Data é preenchida automaticamente com esse dia (no mês sendo
 * lançado), pra não precisar digitar a mesma data em toda compra.
 */

const assert = require('assert');
const { startServer, launchBrowser, newPage, makeRunner } = require('./helpers');

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();
  const { test, report } = makeRunner();

  console.log('Vencimento único por cartão — Conta Aí\n');

  await test('addCartao exige nome e um dia de vencimento válido (1-31)', async () => {
    const page = await newPage(browser, baseUrl);
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.evaluate(() => openModal('cartoes'));

    await page.fill('#new-cartao-name', '');
    await page.fill('#new-cartao-venc', '10');
    await page.evaluate(() => addCartao());

    await page.fill('#new-cartao-name', 'Nubank');
    await page.fill('#new-cartao-venc', '40');
    await page.evaluate(() => addCartao());

    const count = await page.evaluate(() => cartoes.length);
    assert.strictEqual(count, 0, 'não deveria criar cartão sem nome ou com dia inválido');
    assert.ok(dialogs.length >= 2);
    await page.close();
  });

  await test('addCartao cria o cartão já com o dia de vencimento', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('cartoes'));
    await page.fill('#new-cartao-name', 'Nubank');
    await page.fill('#new-cartao-venc', '10');
    await page.evaluate(() => addCartao());
    const cartao = await page.evaluate(() => cartoes[0]);
    assert.strictEqual(cartao.nome, 'Nubank');
    assert.strictEqual(cartao.venc, 10);
    await page.close();
  });

  await test('aplicarVencimentoCartao preenche a Data com o dia do cartão, no mês sendo lançado', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { cartoes.push({ id: 'c1', nome: 'Nubank', venc: 15 }); });
    await page.evaluate(() => openModal('variaveis'));
    await page.selectOption('#v-cartao', 'c1');
    const data = await page.inputValue('#v-data');
    const esperado = await page.evaluate(() => cy + '-' + String(cm + 1).padStart(2, '0') + '-15');
    assert.strictEqual(data, esperado);
    await page.close();
  });

  await test('aplicarVencimentoCartao ajusta o dia em meses menores (ex.: dia 31 em abril)', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      cartoes.push({ id: 'c2', nome: 'Inter', venc: 31 });
      cm = 3; cy = 2026; // abril tem 30 dias
    });
    await page.evaluate(() => openModal('variaveis'));
    await page.selectOption('#v-cartao', 'c2');
    const data = await page.inputValue('#v-data');
    assert.strictEqual(data, '2026-04-30');
    await page.close();
  });

  await test('escolher "Nenhum" cartão não mexe na Data já preenchida', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { cartoes.push({ id: 'c3', nome: 'Inter', venc: 20 }); });
    await page.evaluate(() => openModal('variaveis'));
    await page.fill('#v-data', '2026-09-05');
    await page.selectOption('#v-cartao', '');
    const data = await page.inputValue('#v-data');
    assert.strictEqual(data, '2026-09-05');
    await page.close();
  });

  await test('cartão sem vencimento definido não altera a Data ao ser selecionado', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { cartoes.push({ id: 'c4', nome: 'Sem venc', venc: null }); });
    await page.evaluate(() => openModal('variaveis'));
    await page.fill('#v-data', '2026-09-05');
    await page.selectOption('#v-cartao', 'c4');
    const data = await page.inputValue('#v-data');
    assert.strictEqual(data, '2026-09-05');
    await page.close();
  });

  await test('saveVariavel usa a Data preenchida pelo vencimento do cartão ao salvar', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { cartoes.push({ id: 'c5', nome: 'Nubank', venc: 12 }); });
    await page.evaluate(() => openModal('variaveis'));
    await page.fill('#v-desc', 'Compra no cartão');
    await page.fill('#v-valor', '99.90');
    await page.selectOption('#v-cartao', 'c5');
    await page.evaluate(() => saveVariavel());
    const item = await page.evaluate(() => DB.variaveis.find((v) => v.desc === 'Compra no cartão'));
    const esperado = await page.evaluate(() => cy + '-' + String(cm + 1).padStart(2, '0') + '-12');
    assert.strictEqual(item.data, esperado);
    assert.strictEqual(item.cartaoId, 'c5');
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

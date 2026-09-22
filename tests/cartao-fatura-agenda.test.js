#!/usr/bin/env node
/**
 * Testes da "fatura única por cartão" exibida na aba Agenda do app:
 * soma automaticamente as Despesas Variáveis lançadas num cartão com
 * vencimento cadastrado e mostra isso como 1 item de vencimento — sem
 * precisar marcar cada compra individualmente.
 */

const assert = require('assert');
const { startServer, launchBrowser, newPage, makeRunner } = require('./helpers');

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();
  const { test, report } = makeRunner();

  console.log('Fatura única por cartão na Agenda — Conta Aí\n');

  await test('a Agenda mostra 1 item somando todas as despesas do cartão no mês', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      cartoes.push({ id: 'c1', nome: 'Nubank', venc: 10, pagos: {} });
      DB.variaveis.push({ id: 'v1', desc: 'Mercado', valor: 50, cartaoId: 'c1', m: cm, y: cy, status: 'A pagar' });
      DB.variaveis.push({ id: 'v2', desc: 'Farmácia', valor: 30, cartaoId: 'c1', m: cm, y: cy, status: 'A pagar' });
      renderAll();
    });
    const ocs = await page.evaluate(() => _ocorrenciasCartoesDoMes(cm, cy));
    assert.strictEqual(ocs.length, 1);
    assert.strictEqual(ocs[0].ag.desc, 'Fatura Nubank');
    assert.strictEqual(ocs[0].ag.valor, 80);
    await page.close();
  });

  await test('cartão sem despesas no mês não aparece na Agenda', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { cartoes.push({ id: 'c1', nome: 'Nubank', venc: 10, pagos: {} }); });
    const ocs = await page.evaluate(() => _ocorrenciasCartoesDoMes(cm, cy));
    assert.strictEqual(ocs.length, 0);
    await page.close();
  });

  await test('togglePagoAgenda com prefixo "cartao:" marca a fatura do cartão como paga', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      cartoes.push({ id: 'c1', nome: 'Nubank', venc: 10, pagos: {} });
      DB.variaveis.push({ id: 'v1', desc: 'Mercado', valor: 50, cartaoId: 'c1', m: cm, y: cy, status: 'A pagar' });
      renderAll();
    });
    const chave = await page.evaluate(() => _ocorrenciasCartoesDoMes(cm, cy)[0].chave);
    await page.evaluate((chave) => togglePagoAgenda('cartao:c1', chave), chave);
    const pago = await page.evaluate((chave) => !!cartoes.find((c) => c.id === 'c1').pagos[chave], chave);
    assert.strictEqual(pago, true);
    const ocsDepois = await page.evaluate(() => _ocorrenciasCartoesDoMes(cm, cy));
    assert.strictEqual(ocsDepois[0].pago, true);
    await page.close();
  });

  await test('renderAgenda soma a fatura do cartão nos totais do mês', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      cartoes.push({ id: 'c1', nome: 'Nubank', venc: 10, pagos: {} });
      DB.variaveis.push({ id: 'v1', desc: 'Mercado', valor: 80, cartaoId: 'c1', m: cm, y: cy, status: 'A pagar' });
      renderAll();
    });
    const totalTexto = await page.locator('#s-agenda .sum-card.dest .val').innerText();
    assert.ok(totalTexto.includes('80'), `esperava ver R$ 80 no total agendado, veio "${totalTexto}"`);
    await page.close();
  });

  await test('Despesa Variável num cartão com vencimento não mostra mais o botão individual de Agenda', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      cartoes.push({ id: 'c1', nome: 'Nubank', venc: 10, pagos: {} });
      DB.variaveis.push({ id: 'v1', desc: 'Mercado', valor: 50, cartaoId: 'c1', m: cm, y: cy, status: 'A pagar' });
      renderAll();
    });
    const botaoAtivo = await page.locator('#vr-v1 button.btn-ag').count();
    const badge = await page.locator('#vr-v1 span.btn-ag').count();
    assert.strictEqual(botaoAtivo, 0, 'não deveria ter o botão clicável quando coberto pela fatura');
    assert.strictEqual(badge, 1, 'deveria mostrar o indicador de "incluída na fatura"');
    await page.close();
  });

  await test('Despesa Variável em cartão sem vencimento continua com o botão normal de Agenda', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      cartoes.push({ id: 'c1', nome: 'Sem venc', venc: null, pagos: {} });
      DB.variaveis.push({ id: 'v1', desc: 'Mercado', valor: 50, cartaoId: 'c1', m: cm, y: cy, status: 'A pagar' });
      renderAll();
    });
    const botaoAtivo = await page.locator('#vr-v1 button.btn-ag').count();
    assert.strictEqual(botaoAtivo, 1);
    await page.close();
  });

  await test('já vinculada manualmente à Agenda continua mostrando o botão (pra poder desvincular)', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      cartoes.push({ id: 'c1', nome: 'Nubank', venc: 10, pagos: {} });
      DB.variaveis.push({ id: 'v1', desc: 'Mercado', valor: 50, cartaoId: 'c1', m: cm, y: cy, status: 'A pagar', agendaId: 'algumId' });
      renderAll();
    });
    const botaoAtivo = await page.locator('#vr-v1 button.btn-ag.linked').count();
    assert.strictEqual(botaoAtivo, 1);
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

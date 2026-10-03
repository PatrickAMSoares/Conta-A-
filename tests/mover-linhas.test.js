#!/usr/bin/env node
/**
 * Testes de mover (reordenar manualmente) as linhas de Receitas, Despesas
 * Fixas e Despesas Variáveis — botões ▲▼ que trocam a linha de posição
 * dentro do mês exibido e guardam isso no campo "ordem" de cada item, pra
 * sobreviver a um recarregamento da página.
 */

const assert = require('assert');
const { startServer, launchBrowser, newPage, makeRunner } = require('./helpers');

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();
  const { test, report } = makeRunner();

  console.log('Mover linhas de Receitas/Despesas — Conta Aí\n');

  await test('moverItem(ganhos) troca a ordem de dois itens e renumera', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.ganhos.push({ id: 'g1', desc: 'Salário', cat: 'salario', valor: 100, status: 'A receber', m: cm, y: cy, ordem: 0 });
      DB.ganhos.push({ id: 'g2', desc: 'Freela', cat: 'extra', valor: 50, status: 'A receber', m: cm, y: cy, ordem: 1 });
      renderAll();
    });
    await page.evaluate(() => moverItem('ganhos', 'g2', -1));
    const ordens = await page.evaluate(() => DB.ganhos.map((g) => ({ id: g.id, ordem: g.ordem })));
    assert.strictEqual(ordens.find((o) => o.id === 'g2').ordem, 0);
    assert.strictEqual(ordens.find((o) => o.id === 'g1').ordem, 1);
    await page.close();
  });

  await test('depois de mover, a tabela de Receitas é redesenhada na nova ordem', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.ganhos.push({ id: 'g1', desc: 'Salário', cat: 'salario', valor: 100, status: 'A receber', m: cm, y: cy, ordem: 0 });
      DB.ganhos.push({ id: 'g2', desc: 'Freela', cat: 'extra', valor: 50, status: 'A receber', m: cm, y: cy, ordem: 1 });
      renderAll();
    });
    await page.evaluate(() => moverItem('ganhos', 'g2', -1));
    const idsNaOrdem = await page.evaluate(() => Array.from(document.querySelectorAll('#tb-ganhos tr')).map((tr) => tr.id));
    assert.deepStrictEqual(idsNaOrdem, ['gr-g2', 'gr-g1']);
    await page.close();
  });

  await test('botão ▲ da primeira linha fica desabilitado, e o ▼ da última também', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.fixas.push({ id: 'f1', desc: 'Aluguel', cat: 'casa', valor: 1500, status: 'A pagar', m: cm, y: cy, ordem: 0 });
      DB.fixas.push({ id: 'f2', desc: 'Internet', cat: 'casa', valor: 100, status: 'A pagar', m: cm, y: cy, ordem: 1 });
      renderAll();
    });
    const primeiraSubeDesabilitado = await page.locator('#fr-f1 .btn-mv-wrap button[title="Mover para cima"]').isDisabled();
    const primeiraDesceDesabilitado = await page.locator('#fr-f1 .btn-mv-wrap button[title="Mover para baixo"]').isDisabled();
    const ultimaSubeDesabilitado = await page.locator('#fr-f2 .btn-mv-wrap button[title="Mover para cima"]').isDisabled();
    const ultimaDesceDesabilitado = await page.locator('#fr-f2 .btn-mv-wrap button[title="Mover para baixo"]').isDisabled();
    assert.strictEqual(primeiraSubeDesabilitado, true);
    assert.strictEqual(primeiraDesceDesabilitado, false);
    assert.strictEqual(ultimaSubeDesabilitado, false);
    assert.strictEqual(ultimaDesceDesabilitado, true);
    await page.close();
  });

  await test('clicar no botão ▼ de Despesas Fixas move a linha pra baixo na tela', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.fixas.push({ id: 'f1', desc: 'Aluguel', cat: 'casa', valor: 1500, status: 'A pagar', m: cm, y: cy, ordem: 0 });
      DB.fixas.push({ id: 'f2', desc: 'Internet', cat: 'casa', valor: 100, status: 'A pagar', m: cm, y: cy, ordem: 1 });
      renderAll();
    });
    await page.click('text=Despesas Fixas');
    await page.locator('#fr-f1 .btn-mv-wrap button[title="Mover para baixo"]').click();
    const idsNaOrdem = await page.evaluate(() => Array.from(document.querySelectorAll('#tb-fixas tr')).map((tr) => tr.id));
    assert.deepStrictEqual(idsNaOrdem, ['fr-f2', 'fr-f1']);
    await page.close();
  });

  await test('moverItem(variaveis) respeita apenas os itens do mês em exibição', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.variaveis.push({ id: 'v1', desc: 'Mercado', valor: 50, status: 'A pagar', m: cm, y: cy, ordem: 0 });
      DB.variaveis.push({ id: 'v2', desc: 'Farmácia', valor: 30, status: 'A pagar', m: cm, y: cy, ordem: 1 });
      // item de outro mês não deve interferir na troca
      const outroMes = cm === 0 ? 11 : cm - 1;
      const outroAno = cm === 0 ? cy - 1 : cy;
      DB.variaveis.push({ id: 'v3', desc: 'Antigo', valor: 10, status: 'Pago', m: outroMes, y: outroAno, ordem: 0 });
      renderAll();
    });
    await page.evaluate(() => moverItem('variaveis', 'v2', -1));
    const ordens = await page.evaluate(() => DB.variaveis.map((v) => ({ id: v.id, ordem: v.ordem })));
    assert.strictEqual(ordens.find((o) => o.id === 'v2').ordem, 0);
    assert.strictEqual(ordens.find((o) => o.id === 'v1').ordem, 1);
    assert.strictEqual(ordens.find((o) => o.id === 'v3').ordem, 0, 'item de outro mês não deve ser alterado');
    await page.close();
  });

  await test('mover um item além do limite (fora dos índices) não faz nada', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.ganhos.push({ id: 'g1', desc: 'Salário', cat: 'salario', valor: 100, status: 'A receber', m: cm, y: cy, ordem: 0 });
      renderAll();
    });
    await page.evaluate(() => moverItem('ganhos', 'g1', -1));
    await page.evaluate(() => moverItem('ganhos', 'g1', 1));
    const ordem = await page.evaluate(() => DB.ganhos.find((g) => g.id === 'g1').ordem);
    assert.strictEqual(ordem, 0);
    await page.close();
  });

  await test('ordenarLista ordena Despesas Variáveis pelo campo "ordem", não mais por data', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.variaveis.push({ id: 'v1', desc: 'Lançado depois', valor: 10, status: 'A pagar', m: cm, y: cy, data: '2026-01-01', ordem: 1 });
      DB.variaveis.push({ id: 'v2', desc: 'Lançado antes', valor: 20, status: 'A pagar', m: cm, y: cy, data: '2026-12-31', ordem: 0 });
      ordenarLista('variaveis');
    });
    const idsNaOrdem = await page.evaluate(() => DB.variaveis.map((v) => v.id));
    assert.deepStrictEqual(idsNaOrdem, ['v2', 'v1'], 'deveria respeitar "ordem" (manual) em vez da data da despesa');
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

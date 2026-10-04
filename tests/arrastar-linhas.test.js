#!/usr/bin/env node
/**
 * Testes de arrastar (drag-and-drop) as linhas de Receitas, Despesas Fixas
 * e Despesas Variáveis pela alça "⠿" — usa Pointer Events (funciona com
 * mouse e touch, ao contrário do "draggable" nativo do HTML5) e grava a
 * nova posição no campo "ordem" de cada item.
 */

const assert = require('assert');
const { startServer, launchBrowser, newPage, makeRunner } = require('./helpers');

async function arrastar(page, fromLocator, toLocator, { abaixo = true } = {}) {
  const from = await fromLocator.boundingBox();
  const to = await toLocator.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  const destY = abaixo ? to.y + to.height + 4 : to.y - 4;
  await page.mouse.move(to.x + to.width / 2, destY, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();
  const { test, report } = makeRunner();

  console.log('Arrastar linhas de Receitas/Despesas — Conta Aí\n');

  await test('arrastar uma Receita pra baixo da outra troca a ordem (visual e no DB)', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.ganhos.push({ id: 'g1', desc: 'Salário', cat: 'salario', valor: 100, status: 'A receber', m: cm, y: cy, ordem: 0 });
      DB.ganhos.push({ id: 'g2', desc: 'Freela', cat: 'extra', valor: 50, status: 'A receber', m: cm, y: cy, ordem: 1 });
      renderAll();
    });
    await page.click('text=Receitas');
    await arrastar(page, page.locator('#gr-g1 .drag-handle'), page.locator('#gr-g2 .drag-handle'));
    const idsNaOrdem = await page.evaluate(() => Array.from(document.querySelectorAll('#tb-ganhos tr')).map((tr) => tr.id));
    assert.deepStrictEqual(idsNaOrdem, ['gr-g2', 'gr-g1']);
    const ordem = await page.evaluate(() => DB.ganhos.map((g) => ({ id: g.id, ordem: g.ordem })));
    assert.strictEqual(ordem.find((o) => o.id === 'g2').ordem, 0);
    assert.strictEqual(ordem.find((o) => o.id === 'g1').ordem, 1);
    await page.close();
  });

  await test('arrastar a última Despesa Fixa pra cima das outras duas reordena tudo', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.fixas.push({ id: 'f1', desc: 'Aluguel', cat: 'casa', valor: 1500, status: 'A pagar', m: cm, y: cy, ordem: 0 });
      DB.fixas.push({ id: 'f2', desc: 'Internet', cat: 'casa', valor: 100, status: 'A pagar', m: cm, y: cy, ordem: 1 });
      DB.fixas.push({ id: 'f3', desc: 'Água', cat: 'casa', valor: 80, status: 'A pagar', m: cm, y: cy, ordem: 2 });
      renderAll();
    });
    await page.click('text=Despesas Fixas');
    await arrastar(page, page.locator('#fr-f3 .drag-handle'), page.locator('#fr-f1 .drag-handle'), { abaixo: false });
    const idsNaOrdem = await page.evaluate(() => Array.from(document.querySelectorAll('#tb-fixas tr')).map((tr) => tr.id));
    assert.deepStrictEqual(idsNaOrdem, ['fr-f3', 'fr-f1', 'fr-f2']);
    await page.close();
  });

  await test('arrastar não dispara o modo de edição da descrição (clique na alça não abre edição)', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.ganhos.push({ id: 'g1', desc: 'Salário', cat: 'salario', valor: 100, status: 'A receber', m: cm, y: cy, ordem: 0 });
      DB.ganhos.push({ id: 'g2', desc: 'Freela', cat: 'extra', valor: 50, status: 'A receber', m: cm, y: cy, ordem: 1 });
      renderAll();
    });
    await page.click('text=Receitas');
    // Um clique rápido na alça (sem arrastar de fato) não deve abrir edição
    // em nenhum campo da linha.
    await page.locator('#gr-g1 .drag-handle').click();
    await page.waitForTimeout(100);
    const emEdicao = await page.evaluate(() => document.querySelectorAll('.editing').length);
    assert.strictEqual(emEdicao, 0, 'clicar na alça não deveria entrar em modo de edição');
    await page.close();
  });

  await test('arrastar uma Despesa Variável respeita apenas os itens do mês em exibição', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.variaveis.push({ id: 'v1', desc: 'Mercado', valor: 50, status: 'A pagar', m: cm, y: cy, ordem: 0 });
      DB.variaveis.push({ id: 'v2', desc: 'Farmácia', valor: 30, status: 'A pagar', m: cm, y: cy, ordem: 1 });
      const outroMes = cm === 0 ? 11 : cm - 1;
      const outroAno = cm === 0 ? cy - 1 : cy;
      DB.variaveis.push({ id: 'v3', desc: 'Antigo', valor: 10, status: 'Pago', m: outroMes, y: outroAno, ordem: 0 });
      renderAll();
    });
    await page.click('text=Despesas Variáveis');
    await arrastar(page, page.locator('#vr-v1 .drag-handle'), page.locator('#vr-v2 .drag-handle'));
    const ordem = await page.evaluate(() => DB.variaveis.map((v) => ({ id: v.id, ordem: v.ordem })));
    assert.strictEqual(ordem.find((o) => o.id === 'v2').ordem, 0);
    assert.strictEqual(ordem.find((o) => o.id === 'v1').ordem, 1);
    assert.strictEqual(ordem.find((o) => o.id === 'v3').ordem, 0, 'item de outro mês não deve ser alterado');
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

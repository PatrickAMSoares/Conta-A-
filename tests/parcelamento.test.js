#!/usr/bin/env node
/**
 * Testes automatizados da lógica de parcelamento (e do cálculo de vencimento
 * de Despesas Variáveis) do Conta Aí.
 *
 * Como rodar:
 *   npm install
 *   npx playwright install chromium   (só na primeira vez)
 *   npm test
 *
 * Como funciona: sobe um servidor estático local servindo o index.html real
 * (o mesmo arquivo publicado), abre num Chromium headless com um SDK do
 * Firebase falso (nenhuma chamada de rede/Firestore acontece — os testes
 * nunca tocam em dados reais), e chama as funções reais do app
 * (saveVariavel, _addMonthsISO, checkVencimentos etc.) exatamente como um
 * clique do usuário chamaria, conferindo o resultado em DB.variaveis.
 */

const assert = require('assert');
const { startServer, launchBrowser, newPage, makeRunner } = require('./helpers');

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();
  const { test, report } = makeRunner();

  console.log('Parcelamento e vencimento — Conta Aí\n');

  // ── _addMonthsISO: matemática de datas ─────────────────────────────────
  await test('_addMonthsISO avança meses preservando o dia', async () => {
    const page = await newPage(browser, baseUrl);
    const r = await page.evaluate(() => _addMonthsISO('2026-01-15', 2));
    assert.strictEqual(r, '2026-03-15');
    await page.close();
  });

  await test('_addMonthsISO ajusta dia 31 em mês menor (fev)', async () => {
    const page = await newPage(browser, baseUrl);
    const r = await page.evaluate(() => _addMonthsISO('2026-01-31', 1));
    assert.strictEqual(r, '2026-02-28'); // 2026 não é bissexto
    await page.close();
  });

  await test('_addMonthsISO vira o ano corretamente', async () => {
    const page = await newPage(browser, baseUrl);
    const r = await page.evaluate(() => _addMonthsISO('2026-11-10', 3));
    assert.strictEqual(r, '2027-02-10');
    await page.close();
  });

  // ── Compra parcelada normal (sem "em andamento") ───────────────────────
  await test('parcelamento normal cria N parcelas numeradas 1..N', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('variaveis'));
    await page.evaluate(() => {
      document.getElementById('v-desc').value = 'Notebook';
      document.getElementById('v-valor').value = '100';
      document.getElementById('v-data').value = _hojeISO();
      document.getElementById('v-parc').checked = true; toggleParcelas();
      document.getElementById('v-parc-qtd').value = '3';
    });
    await page.evaluate(() => saveVariavel());
    await page.waitForTimeout(150);
    const items = await page.evaluate(() =>
      DB.variaveis.filter((v) => v.desc === 'Notebook').sort((a, b) => a.parcNum - b.parcNum)
    );
    assert.strictEqual(items.length, 3);
    assert.deepStrictEqual(items.map((i) => i.parcNum), [1, 2, 3]);
    items.forEach((i) => assert.strictEqual(i.parcTot, 3));
    await page.close();
  });

  await test('parcelamento distribui centavos: sobra vai para a última parcela', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('variaveis'));
    await page.evaluate(() => {
      document.getElementById('v-desc').value = 'Sofa';
      document.getElementById('v-valor').value = '100'; // total
      document.getElementById('v-data').value = _hojeISO();
      document.getElementById('v-parc').checked = true; toggleParcelas();
      document.getElementById('v-parc-qtd').value = '3';
      document.getElementById('v-parc-modo').value = 'total';
    });
    await page.evaluate(() => saveVariavel());
    await page.waitForTimeout(150);
    const valores = await page.evaluate(() =>
      DB.variaveis.filter((v) => v.desc === 'Sofa').sort((a, b) => a.parcNum - b.parcNum).map((v) => v.valor)
    );
    // 100 / 3 = 33.33, 33.33, 33.34 (resto na última)
    assert.deepStrictEqual(valores, [33.33, 33.33, 33.34]);
    const soma = valores.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(soma - 100) < 0.001, `soma das parcelas (${soma}) deveria ser 100`);
    await page.close();
  });

  // ── Compra já em andamento ──────────────────────────────────────────────
  await test('compra em andamento cria só as parcelas restantes, numeradas certo', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('variaveis'));
    await page.evaluate(() => {
      document.getElementById('v-desc').value = 'TV';
      document.getElementById('v-valor').value = '100';
      document.getElementById('v-data').value = _hojeISO();
      document.getElementById('v-parc').checked = true; toggleParcelas();
      document.getElementById('v-parc-qtd').value = '12';
      document.getElementById('v-parc-andamento').checked = true; toggleParcAndamento();
      document.getElementById('v-parc-atual').value = '4';
    });
    await page.evaluate(() => saveVariavel());
    await page.waitForTimeout(150);
    const items = await page.evaluate(() =>
      DB.variaveis.filter((v) => v.desc === 'TV').sort((a, b) => a.parcNum - b.parcNum)
    );
    assert.strictEqual(items.length, 9, 'deveria criar as parcelas 4 a 12 (9 no total)');
    assert.deepStrictEqual(items.map((i) => i.parcNum), [4, 5, 6, 7, 8, 9, 10, 11, 12]);
    items.forEach((i) => {
      assert.strictEqual(i.parcTot, 12);
      assert.strictEqual(i.valor, 100);
    });
    // datas mensais consecutivas a partir de hoje
    const datas = items.map((i) => i.data);
    for (let k = 1; k < datas.length; k++) {
      const esperado = await page.evaluate((d) => _addMonthsISO(d, 1), datas[k - 1]);
      assert.strictEqual(datas[k], esperado);
    }
    await page.close();
  });

  await test('compra em andamento na última parcela cria só 1 lançamento', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('variaveis'));
    await page.evaluate(() => {
      document.getElementById('v-desc').value = 'Geladeira';
      document.getElementById('v-valor').value = '30';
      document.getElementById('v-data').value = _hojeISO();
      document.getElementById('v-parc').checked = true; toggleParcelas();
      document.getElementById('v-parc-qtd').value = '5';
      document.getElementById('v-parc-andamento').checked = true; toggleParcAndamento();
      document.getElementById('v-parc-atual').value = '5';
    });
    await page.evaluate(() => saveVariavel());
    await page.waitForTimeout(150);
    const items = await page.evaluate(() => DB.variaveis.filter((v) => v.desc === 'Geladeira'));
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].parcNum, 5);
    assert.strictEqual(items[0].parcTot, 5);
    await page.close();
  });

  await test('parcela atual fora do intervalo (maior que o total) é rejeitada', async () => {
    const page = await newPage(browser, baseUrl);
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.evaluate(() => openModal('variaveis'));
    await page.evaluate(() => {
      document.getElementById('v-desc').value = 'Invalido';
      document.getElementById('v-valor').value = '10';
      document.getElementById('v-data').value = _hojeISO();
      document.getElementById('v-parc').checked = true; toggleParcelas();
      document.getElementById('v-parc-qtd').value = '3';
      document.getElementById('v-parc-andamento').checked = true; toggleParcAndamento();
      document.getElementById('v-parc-atual').value = '5';
    });
    await page.evaluate(() => saveVariavel());
    await page.waitForTimeout(150);
    const count = await page.evaluate(() => DB.variaveis.filter((v) => v.desc === 'Invalido').length);
    assert.strictEqual(count, 0, 'não deveria criar nada com parcela atual inválida');
    assert.ok(dialogs.length >= 1, 'deveria mostrar um alerta explicando o problema');
    await page.close();
  });

  // ── Bloqueio de meses passados ──────────────────────────────────────────
  await test('despesa (parcelada ou não) com data de mês passado é bloqueada', async () => {
    const page = await newPage(browser, baseUrl);
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.evaluate(() => openModal('variaveis'));
    await page.evaluate(() => {
      document.getElementById('v-desc').value = 'Antiga';
      document.getElementById('v-valor').value = '10';
      document.getElementById('v-data').value = '2000-01-01';
    });
    await page.evaluate(() => saveVariavel());
    await page.waitForTimeout(150);
    const count = await page.evaluate(() => DB.variaveis.filter((v) => v.desc === 'Antiga').length);
    assert.strictEqual(count, 0);
    assert.ok(dialogs.length >= 1);
    await page.close();
  });

  // ── checkVencimentos: status "Em atraso" ────────────────────────────────
  await test('despesa que vence hoje NÃO vira "Em atraso" antes do dia acabar', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.variaveis.push({ id: 'v1', desc: 'Vence hoje', valor: 10, data: _hojeISO(), status: 'A pagar', m: cm, y: cy });
      checkVencimentos();
    });
    const status = await page.evaluate(() => DB.variaveis.find((v) => v.id === 'v1').status);
    assert.strictEqual(status, 'A pagar', 'não deveria marcar como atrasado no próprio dia do vencimento');
    await page.close();
  });

  await test('despesa vencida ontem vira "Em atraso"', async () => {
    const page = await newPage(browser, baseUrl);
    const status = await page.evaluate(() => {
      const ontem = new Date();
      ontem.setDate(ontem.getDate() - 1);
      const iso = ontem.getFullYear() + '-' + String(ontem.getMonth() + 1).padStart(2, '0') + '-' + String(ontem.getDate()).padStart(2, '0');
      DB.variaveis.push({ id: 'v2', desc: 'Venceu ontem', valor: 10, data: iso, status: 'A pagar', m: cm, y: cy });
      checkVencimentos();
      return DB.variaveis.find((v) => v.id === 'v2').status;
    });
    assert.strictEqual(status, 'Em atraso');
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

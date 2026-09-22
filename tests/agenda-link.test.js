#!/usr/bin/env node
/**
 * Testes do botão "Adicionar à Agenda" (📆) nas linhas de Despesas Fixas e
 * Variáveis — cria (ou remove) um item "único" correspondente na Agenda,
 * pra o usuário não precisar cadastrar o mesmo vencimento duas vezes.
 */

const assert = require('assert');
const { startServer, launchBrowser, newPage, makeRunner } = require('./helpers');

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();
  const { test, report } = makeRunner();

  console.log('Vincular Despesas Fixas/Variáveis à Agenda — Conta Aí\n');

  await test('toggleAgendaLink cria um item único na Agenda a partir de uma Despesa Fixa', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.fixas.push({ id: 'f1', desc: 'Aluguel', cat: 'casa', valor: 1500, venc: 10, status: 'A pagar', m: cm, y: cy });
      renderAll();
    });
    await page.evaluate(() => toggleAgendaLink('fixa', 'f1'));
    const resultado = await page.evaluate(() => ({
      agenda: DB.agenda,
      agendaIdNaFixa: DB.fixas.find((f) => f.id === 'f1').agendaId,
    }));
    assert.strictEqual(resultado.agenda.length, 1);
    assert.strictEqual(resultado.agenda[0].tipo, 'unica');
    assert.strictEqual(resultado.agenda[0].desc, 'Aluguel');
    assert.strictEqual(resultado.agenda[0].valor, 1500);
    const mesEsperado = await page.evaluate(() => String(cm + 1).padStart(2, '0'));
    const anoEsperado = await page.evaluate(() => String(cy));
    assert.strictEqual(resultado.agenda[0].data, `${anoEsperado}-${mesEsperado}-10`);
    assert.strictEqual(resultado.agendaIdNaFixa, resultado.agenda[0].id);
    await page.close();
  });

  await test('toggleAgendaLink de novo remove o item da Agenda e desfaz o vínculo', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.fixas.push({ id: 'f2', desc: 'Internet', cat: 'casa', valor: 120, venc: 15, status: 'A pagar', m: cm, y: cy });
      renderAll();
      toggleAgendaLink('fixa', 'f2');
    });
    const antes = await page.evaluate(() => DB.agenda.length);
    await page.evaluate(() => toggleAgendaLink('fixa', 'f2'));
    const depois = await page.evaluate(() => ({ agenda: DB.agenda.length, agendaId: DB.fixas.find((f) => f.id === 'f2').agendaId }));
    assert.strictEqual(antes, 1);
    assert.strictEqual(depois.agenda, 0);
    assert.strictEqual(depois.agendaId, undefined);
    await page.close();
  });

  await test('toggleAgendaLink recusa Despesa Fixa sem dia de vencimento preenchido', async () => {
    const page = await newPage(browser, baseUrl);
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.evaluate(() => {
      DB.fixas.push({ id: 'f3', desc: 'Sem dia', cat: 'outros', valor: 50, venc: '', status: 'A pagar', m: cm, y: cy });
      renderAll();
    });
    await page.evaluate(() => toggleAgendaLink('fixa', 'f3'));
    const agenda = await page.evaluate(() => DB.agenda.length);
    assert.strictEqual(agenda, 0);
    assert.ok(dialogs.length >= 1);
    await page.close();
  });

  await test('toggleAgendaLink cria um item único na Agenda a partir de uma Despesa Variável', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      DB.variaveis.push({ id: 'v1', desc: 'Mercado', cat: 'mercado', valor: 250, data: _hojeISO(), status: 'A pagar', m: cm, y: cy });
      renderAll();
    });
    await page.evaluate(() => toggleAgendaLink('variavel', 'v1'));
    const resultado = await page.evaluate(() => ({
      agenda: DB.agenda,
      agendaIdNaVariavel: DB.variaveis.find((v) => v.id === 'v1').agendaId,
    }));
    assert.strictEqual(resultado.agenda.length, 1);
    assert.strictEqual(resultado.agenda[0].tipo, 'unica');
    const hoje = await page.evaluate(() => _hojeISO());
    assert.strictEqual(resultado.agenda[0].data, hoje);
    assert.strictEqual(resultado.agendaIdNaVariavel, resultado.agenda[0].id);
    await page.close();
  });

  await test('delFixa remove também o item vinculado na Agenda', async () => {
    const page = await newPage(browser, baseUrl);
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.evaluate(() => {
      DB.fixas.push({ id: 'f4', desc: 'Condomínio', cat: 'casa', valor: 400, venc: 5, status: 'A pagar', m: cm, y: cy });
      renderAll();
      toggleAgendaLink('fixa', 'f4');
    });
    const antes = await page.evaluate(() => DB.agenda.length);
    await page.evaluate(() => delFixa('f4'));
    const depois = await page.evaluate(() => ({ agenda: DB.agenda.length, fixa: DB.fixas.find((f) => f.id === 'f4') }));
    assert.strictEqual(antes, 1);
    assert.strictEqual(depois.agenda, 0);
    assert.strictEqual(depois.fixa, undefined);
    await page.close();
  });

  await test('delAgenda desfaz o vínculo na Despesa Fixa de origem', async () => {
    const page = await newPage(browser, baseUrl);
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    let agendaId;
    await page.evaluate(() => {
      DB.fixas.push({ id: 'f5', desc: 'Água', cat: 'casa', valor: 90, venc: 8, status: 'A pagar', m: cm, y: cy });
      renderAll();
      toggleAgendaLink('fixa', 'f5');
    });
    agendaId = await page.evaluate(() => DB.agenda[0].id);
    await page.evaluate((id) => delAgenda(id), agendaId);
    const depois = await page.evaluate(() => ({ agenda: DB.agenda.length, agendaIdNaFixa: DB.fixas.find((f) => f.id === 'f5').agendaId }));
    assert.strictEqual(depois.agenda, 0);
    assert.strictEqual(depois.agendaIdNaFixa, undefined);
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

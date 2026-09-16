#!/usr/bin/env node
/**
 * Testes automatizados da importação de dados via CSV do Conta Aí (botão
 * "Importar dados" no rodapé). Cobre o parser de CSV, a validação de cada
 * linha e o fluxo completo de importação (arquivo -> pré-visualização ->
 * confirmação -> lançamentos criados em DB.ganhos/fixas/variaveis).
 *
 * Como rodar:
 *   npm install
 *   npx playwright install chromium   (só na primeira vez)
 *   npm test
 */

const assert = require('assert');
const { startServer, launchBrowser, newPage, makeRunner } = require('./helpers');

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();
  const { test, report } = makeRunner();

  console.log('Importação de dados (CSV) — Conta Aí\n');

  // ── Parser: delimitador, comentários, aspas ─────────────────────────────
  await test('_parseCSV detecta ";" como delimitador e ignora linhas de comentário', async () => {
    const page = await newPage(browser, baseUrl);
    const linhas = await page.evaluate(() => _parseCSV(
      'Tipo;Descricao;Categoria;Valor;Data;Status\n' +
      '# comentário deve ser ignorado\n' +
      'Fixa;Aluguel;Casa;1200,00;10/03/2026;Pago\n'
    ));
    assert.strictEqual(linhas.length, 2);
    assert.deepStrictEqual(linhas[0], ['Tipo', 'Descricao', 'Categoria', 'Valor', 'Data', 'Status']);
    assert.deepStrictEqual(linhas[1], ['Fixa', 'Aluguel', 'Casa', '1200,00', '10/03/2026', 'Pago']);
    await page.close();
  });

  await test('_parseCSV detecta "," como delimitador quando não há ";"', async () => {
    const page = await newPage(browser, baseUrl);
    const linhas = await page.evaluate(() => _parseCSV(
      'Tipo,Descricao,Categoria,Valor,Data,Status\n' +
      'Variável,Mercado,Mercado,150.00,05/03/2026,Pago\n'
    ));
    assert.deepStrictEqual(linhas[1], ['Variável', 'Mercado', 'Mercado', '150.00', '05/03/2026', 'Pago']);
    await page.close();
  });

  await test('_parseCSV respeita campos entre aspas contendo o delimitador', async () => {
    const page = await newPage(browser, baseUrl);
    const linhas = await page.evaluate(() => _parseCSV(
      'Tipo;Descricao;Categoria;Valor;Data;Status\n' +
      'Fixa;"Curso, Inglês";Educação;300,00;15/01/2026;Pago\n'
    ));
    assert.strictEqual(linhas[1][1], 'Curso, Inglês');
    await page.close();
  });

  // ── Conversores auxiliares ───────────────────────────────────────────────
  await test('_parseValorImport aceita vírgula ou ponto decimal', async () => {
    const page = await newPage(browser, baseUrl);
    const r = await page.evaluate(() => [
      _parseValorImport('150,00'),
      _parseValorImport('1.234,56'),
      _parseValorImport('150.00'),
      _parseValorImport('R$ 99,90'),
    ]);
    assert.deepStrictEqual(r, [150, 1234.56, 150, 99.9]);
    await page.close();
  });

  await test('_parseDataImport converte DD/MM/AAAA para ISO e rejeita formatos inválidos', async () => {
    const page = await newPage(browser, baseUrl);
    const r = await page.evaluate(() => [
      _parseDataImport('05/03/2026'),
      _parseDataImport('31/13/2026'),
      _parseDataImport(''),
    ]);
    assert.deepStrictEqual(r, ['2026-03-05', null, null]);
    await page.close();
  });

  await test('_parseDataImport também aceita ano com 2 dígitos e formato ISO (AAAA-MM-DD)', async () => {
    const page = await newPage(browser, baseUrl);
    const r = await page.evaluate(() => [
      _parseDataImport('05/03/26'),
      _parseDataImport('2026-03-05'),
      _parseDataImport('2026-13-05'),
    ]);
    assert.deepStrictEqual(r, ['2026-03-05', '2026-03-05', null]);
    await page.close();
  });

  await test('_matchTipo reconhece Receita/Fixa/Variável (ou R/F/V) ignorando acento e caixa', async () => {
    const page = await newPage(browser, baseUrl);
    const r = await page.evaluate(() => [
      _matchTipo('Receita'), _matchTipo('receita'),
      _matchTipo('Fixa'), _matchTipo('variavel'), _matchTipo('Variável'),
      _matchTipo('R'), _matchTipo('f'), _matchTipo('v'),
      _matchTipo('outra coisa'),
    ]);
    assert.deepStrictEqual(r, ['receita', 'receita', 'fixa', 'variavel', 'variavel', 'receita', 'fixa', 'variavel', null]);
    await page.close();
  });

  await test('_matchCategoria casa com CAT_OPTS e cai para "outros" quando não reconhece', async () => {
    const page = await newPage(browser, baseUrl);
    const r = await page.evaluate(() => [
      _matchCategoria('Casa'), _matchCategoria('Saúde'), _matchCategoria('educacao'),
      _matchCategoria('Categoria Inexistente'), _matchCategoria(''),
    ]);
    assert.deepStrictEqual(r, ['casa', 'saude', 'educacao', 'outros', 'outros']);
    await page.close();
  });

  // ── processarImportacao: validação linha a linha ────────────────────────
  await test('processarImportacao separa linhas válidas de linhas com erro', async () => {
    const page = await newPage(browser, baseUrl);
    const { validos, erros } = await page.evaluate(() => processarImportacao(
      'Tipo;Descricao;Categoria;Valor;Data;Status\n' +
      'Variável;Mercado;Mercado;150,00;05/03/2026;Pago\n' +
      'Fixa;Aluguel;Casa;1200,00;10/03/2026;Pago\n' +
      'TipoErrado;Algo;Casa;10,00;01/01/2026;Pago\n' +
      'Variável;;Casa;10,00;01/01/2026;Pago\n' +
      'Variável;Sem valor;Casa;abc;01/01/2026;Pago\n' +
      'Variável;Sem data;Casa;10,00;31/13/2026;Pago\n'
    ));
    assert.strictEqual(validos.length, 2);
    assert.strictEqual(erros.length, 4);
    assert.strictEqual(validos[0].tipo, 'variavel');
    assert.strictEqual(validos[0].valor, 150);
    assert.strictEqual(validos[0].data, '2026-03-05');
    assert.strictEqual(validos[1].tipo, 'fixa');
    assert.strictEqual(validos[1].venc, 10);
    await page.close();
  });

  await test('processarImportacao ignora linhas totalmente em branco', async () => {
    const page = await newPage(browser, baseUrl);
    const { validos, erros } = await page.evaluate(() => processarImportacao(
      'Tipo;Descricao;Categoria;Valor;Data;Status\n' +
      'Variável;Mercado;Mercado;150,00;05/03/2026;Pago\n' +
      ';;;;;\n'
    ));
    assert.strictEqual(validos.length, 1);
    assert.strictEqual(erros.length, 0);
    await page.close();
  });

  await test('processarImportacao aceita receita sem categoria e deriva status A receber/Recebido', async () => {
    const page = await newPage(browser, baseUrl);
    const { validos } = await page.evaluate(() => processarImportacao(
      'Tipo;Descricao;Categoria;Valor;Data;Status\n' +
      'Receita;Salário;;5000,00;05/03/2026;Recebido\n' +
      'Receita;Freela;;500,00;10/03/2026;Pendente\n'
    ));
    assert.strictEqual(validos.length, 2);
    assert.strictEqual(validos[0].status, 'Recebido');
    assert.strictEqual(validos[1].status, 'A receber');
    assert.strictEqual(validos[0].cat, undefined);
    await page.close();
  });

  // ── Fluxo completo: importar aceita datas passadas (diferente do lançamento manual) ─
  await test('confirmarImportacao cria lançamentos em DB.ganhos/fixas/variaveis, mesmo com data passada', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      const csv = 'Tipo;Descricao;Categoria;Valor;Data;Status\n' +
        'Receita;Salário;;5000,00;05/01/2020;Recebido\n' +
        'Fixa;Aluguel;Casa;1200,00;10/01/2020;Pago\n' +
        'Variável;Mercado;Mercado;150,00;15/01/2020;Pago\n';
      const { validos } = processarImportacao(csv);
      _importPendentes = validos;
      confirmarImportacao();
    });
    const [ganhos, fixas, variaveis] = await page.evaluate(() => [DB.ganhos, DB.fixas, DB.variaveis]);
    assert.strictEqual(ganhos.length, 1);
    assert.strictEqual(ganhos[0].desc, 'Salário');
    assert.strictEqual(ganhos[0].m, 0); // janeiro = mês 0
    assert.strictEqual(ganhos[0].y, 2020);
    assert.strictEqual(ganhos[0].whoId, await page.evaluate(() => currentUserId()));

    assert.strictEqual(fixas.length, 1);
    assert.strictEqual(fixas[0].desc, 'Aluguel');
    assert.strictEqual(fixas[0].venc, 10);
    assert.strictEqual(fixas[0].cat, 'casa');

    assert.strictEqual(variaveis.length, 1);
    assert.strictEqual(variaveis[0].desc, 'Mercado');
    assert.strictEqual(variaveis[0].data, '2020-01-15');
    assert.strictEqual(variaveis[0].cat, 'mercado');
    await page.close();
  });

  await test('confirmarImportacao não deixa pendentes residuais entre importações (_importPendentes é limpo)', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      const { validos } = processarImportacao(
        'Tipo;Descricao;Categoria;Valor;Data;Status\n' +
        'Variável;Item1;Casa;10,00;01/01/2020;Pago\n'
      );
      _importPendentes = validos;
      confirmarImportacao();
    });
    const pendentesDepois = await page.evaluate(() => _importPendentes.length);
    assert.strictEqual(pendentesDepois, 0);
    await page.close();
  });

  // ── UI: modelo, upload e pré-visualização ────────────────────────────────
  await test('handleImportFile lê o CSV enviado e mostra a pré-visualização com contagem correta', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('import'));
    const csv = 'Tipo;Descricao;Categoria;Valor;Data;Status\n' +
      'Receita;Salário;;5000,00;05/01/2020;Recebido\n' +
      'Fixa;Aluguel;Casa;1200,00;10/01/2020;Pago\n' +
      'Variável;Mercado;Mercado;150,00;15/01/2020;Pago\n' +
      'TipoErrado;Algo;Casa;10,00;01/01/2020;Pago\n';
    await page.setInputFiles('#import-file', {
      name: 'lancamentos.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });
    await page.waitForTimeout(200);
    const summary = await page.locator('#import-preview-summary').innerText();
    const erros = await page.locator('#import-preview-erros').innerText();
    const btnVisible = await page.locator('#import-btn-confirmar').isVisible();
    assert.ok(summary.includes('3'), 'resumo deveria mencionar os 3 lançamentos válidos');
    assert.ok(erros.includes('1'), 'deveria listar a 1 linha com erro');
    assert.ok(btnVisible, 'botão de confirmar deveria aparecer quando há lançamentos válidos');
    await page.close();
  });

  await test('resetImportModal (ao reabrir o modal) volta para a etapa inicial e limpa pendentes', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      _importPendentes = [{ tipo: 'fixa', desc: 'x', valor: 1, data: '2020-01-01', status: 'Pago', cat: 'outros', venc: 1, m: 0, y: 2020 }];
    });
    await page.evaluate(() => openModal('import'));
    const pendentes = await page.evaluate(() => _importPendentes.length);
    const inicioVisible = await page.locator('#import-step-inicio').isVisible();
    const previewVisible = await page.locator('#import-step-preview').isVisible();
    assert.strictEqual(pendentes, 0);
    assert.ok(inicioVisible);
    assert.ok(!previewVisible);
    await page.close();
  });

  await test('o modelo baixado (com instruções e exemplos) é lido de volta sem nenhum erro', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('import'));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => baixarModeloImportacao()),
    ]);
    const filePath = await download.path();
    const fs = require('fs');
    const conteudo = fs.readFileSync(filePath, 'utf-8');
    const { validos, erros } = await page.evaluate((texto) => processarImportacao(texto), conteudo);
    assert.strictEqual(erros.length, 0, 'o modelo não deveria conter nenhuma linha com erro');
    assert.strictEqual(validos.length, 3, 'o modelo traz 3 lançamentos de exemplo (um de cada tipo)');
    assert.deepStrictEqual(validos.map((v) => v.tipo).sort(), ['fixa', 'receita', 'variavel']);
    validos.forEach((v) => assert.ok(v.desc.startsWith('Exemplo'), 'os exemplos devem estar marcados como tal na descrição'));
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

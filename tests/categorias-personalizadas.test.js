#!/usr/bin/env node
/**
 * Testes das categorias de despesa criadas pelo próprio usuário (modal
 * "Categorias" em Configurações) — complementam as categorias fixas do
 * app (CAT_OPTS) e aparecem nos selects de Despesas Fixas/Variáveis, no
 * gráfico de pizza, na exportação e na importação por CSV.
 */

const assert = require('assert');
const { startServer, launchBrowser, newPage, makeRunner } = require('./helpers');

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();
  const { test, report } = makeRunner();

  console.log('Categorias personalizadas — Conta Aí\n');

  await test('addCategoria cria uma categoria nova e recusa nome vazio', async () => {
    const page = await newPage(browser, baseUrl);
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.evaluate(() => openModal('categorias'));
    await page.evaluate(() => addCategoria());
    const semNome = await page.evaluate(() => categoriasCustom.length);
    assert.strictEqual(semNome, 0);
    assert.ok(dialogs.length >= 1, 'deveria pedir o nome da categoria');

    await page.fill('#new-categoria-nome', 'Pet');
    await page.fill('#new-categoria-emoji', '🐶');
    await page.evaluate(() => addCategoria());
    const categorias = await page.evaluate(() => categoriasCustom);
    assert.strictEqual(categorias.length, 1);
    assert.strictEqual(categorias[0].nome, 'Pet');
    assert.strictEqual(categorias[0].emoji, '🐶');
    assert.ok(categorias[0].id, 'deveria ter gerado um id');
    await page.close();
  });

  await test('clicar num emoji da lista de sugestões preenche o campo de emoji', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('categorias'));
    await page.click('#categoria-emoji-picker button:has-text("✈️")');
    const valor = await page.inputValue('#new-categoria-emoji');
    assert.strictEqual(valor, '✈️');
    const selecionado = await page.locator('#categoria-emoji-picker button.sel').innerText();
    assert.strictEqual(selecionado, '✈️');
    await page.close();
  });

  await test('escolher um emoji da lista e salvar cria a categoria com aquele emoji', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('categorias'));
    await page.fill('#new-categoria-nome', 'Viagem');
    await page.click('#categoria-emoji-picker button:has-text("🏖️")');
    await page.evaluate(() => addCategoria());
    const categoria = await page.evaluate(() => categoriasCustom[0]);
    assert.strictEqual(categoria.emoji, '🏖️');
    await page.close();
  });

  await test('depois de adicionar, o formulário limpa e nenhum emoji fica marcado como selecionado', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('categorias'));
    await page.fill('#new-categoria-nome', 'Viagem');
    await page.click('#categoria-emoji-picker button:has-text("🏖️")');
    await page.evaluate(() => addCategoria());
    const valorEmoji = await page.inputValue('#new-categoria-emoji');
    const marcados = await page.locator('#categoria-emoji-picker button.sel').count();
    assert.strictEqual(valorEmoji, '');
    assert.strictEqual(marcados, 0);
    await page.close();
  });

  await test('reabrir o modal de categorias limpa a seleção de emoji de uma tentativa anterior', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('categorias'));
    await page.click('#categoria-emoji-picker button:has-text("🐶")');
    await page.evaluate(() => { closeModal('categorias'); openModal('categorias'); });
    const valorEmoji = await page.inputValue('#new-categoria-emoji');
    const marcados = await page.locator('#categoria-emoji-picker button.sel').count();
    assert.strictEqual(valorEmoji, '');
    assert.strictEqual(marcados, 0);
    await page.close();
  });

  await test('digitar um emoji manualmente continua funcionando (a lista é só um atalho)', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('categorias'));
    await page.fill('#new-categoria-nome', 'Academia');
    await page.fill('#new-categoria-emoji', '💪');
    await page.evaluate(() => addCategoria());
    const categoria = await page.evaluate(() => categoriasCustom[0]);
    assert.strictEqual(categoria.emoji, '💪');
    await page.close();
  });

  await test('não cria uma categoria duplicada (mesmo nome, ignorando maiúsculas)', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { categoriasCustom.push({ id: 'cat1', nome: 'Pet', emoji: '🐶', cor: '#9ca3af' }); });
    await page.fill('#new-categoria-nome', 'pet');
    await page.evaluate(() => addCategoria());
    const total = await page.evaluate(() => categoriasCustom.length);
    assert.strictEqual(total, 1);
    await page.close();
  });

  await test('removeCategoria remove a categoria da lista', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      categoriasCustom.push({ id: 'cat1', nome: 'Pet', emoji: '🐶', cor: '#9ca3af' });
      categoriasCustom.push({ id: 'cat2', nome: 'Viagem', emoji: '✈️', cor: '#60a5fa' });
      openModal('categorias');
    });
    await page.evaluate(() => removeCategoria(0));
    const restantes = await page.evaluate(() => categoriasCustom.map((c) => c.nome));
    assert.deepStrictEqual(restantes, ['Viagem']);
    await page.close();
  });

  await test('categoria própria aparece como opção nos selects de Despesa Fixa e Variável', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { categoriasCustom.push({ id: 'cat1', nome: 'Pet', emoji: '🐶', cor: '#9ca3af' }); });
    await page.evaluate(() => openModal('fixas'));
    await page.evaluate(() => openModal('variaveis'));
    const temNoFixas = await page.locator('#f-cat option[value="cat1"]').count();
    const temNoVariaveis = await page.locator('#v-cat option[value="cat1"]').count();
    assert.strictEqual(temNoFixas, 1);
    assert.strictEqual(temNoVariaveis, 1);
    await page.close();
  });

  await test('reabrir o modal não duplica as opções de categoria própria no select', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { categoriasCustom.push({ id: 'cat1', nome: 'Pet', emoji: '🐶', cor: '#9ca3af' }); });
    await page.evaluate(() => { openModal('fixas'); closeModal('fixas'); openModal('fixas'); closeModal('fixas'); openModal('fixas'); });
    const total = await page.locator('#f-cat option[value="cat1"]').count();
    assert.strictEqual(total, 1);
    await page.close();
  });

  await test('uma Despesa Fixa lançada numa categoria própria mostra o nome e o emoji corretos', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      categoriasCustom.push({ id: 'cat1', nome: 'Pet', emoji: '🐶', cor: '#9ca3af' });
      DB.fixas.push({ id: 'f1', desc: 'Ração', cat: 'cat1', valor: 80, status: 'A pagar', m: cm, y: cy });
      renderAll();
    });
    const texto = await page.locator('#f-cat-f1').innerText();
    assert.ok(texto.includes('Pet'), `esperava ver "Pet" no chip, veio "${texto}"`);
    assert.ok(texto.includes('🐶'), `esperava ver o emoji no chip, veio "${texto}"`);
    await page.close();
  });

  await test('categoriaOpts() junta as categorias fixas do app com as criadas pelo usuário', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { categoriasCustom.push({ id: 'cat1', nome: 'Pet', emoji: '🐶', cor: '#9ca3af' }); });
    const opts = await page.evaluate(() => categoriaOpts().map((o) => o.v));
    assert.ok(opts.includes('casa'), 'deveria continuar tendo as categorias padrão');
    assert.ok(opts.includes('cat1'), 'deveria incluir a categoria criada pelo usuário');
    await page.close();
  });

  await test('_matchCategoria (importação de CSV) reconhece o nome de uma categoria própria', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { categoriasCustom.push({ id: 'cat1', nome: 'Pet', emoji: '🐶', cor: '#9ca3af' }); });
    const resultado = await page.evaluate(() => _matchCategoria('Pet'));
    assert.strictEqual(resultado, 'cat1');
    await page.close();
  });

  await test('remover uma categoria própria não quebra a exibição de itens que já usavam ela', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => {
      categoriasCustom.push({ id: 'cat1', nome: 'Pet', emoji: '🐶', cor: '#9ca3af' });
      DB.fixas.push({ id: 'f1', desc: 'Ração', cat: 'cat1', valor: 80, status: 'A pagar', m: cm, y: cy });
      renderAll();
      removeCategoria(0);
    });
    const texto = await page.locator('#f-cat-f1').innerText();
    assert.ok(texto.length > 0, 'não deveria quebrar/ficar vazio, mesmo sem a categoria original');
    await page.close();
  });

  await test('categoriasCustom entra na persistência (o que a sincronização com o Firestore grava)', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { categoriasCustom.push({ id: 'cat1', nome: 'Pet', emoji: '🐶', cor: '#9ca3af' }); });
    const salvo = await page.evaluate(() => JSON.parse(_metaSnapshot()).categoriasCustom);
    assert.strictEqual(salvo.length, 1);
    assert.strictEqual(salvo[0].nome, 'Pet');
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

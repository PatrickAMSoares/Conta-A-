#!/usr/bin/env node
/**
 * Testes do "Lançar por texto" (botão ✨ no topo): um interpretador local,
 * sem IA externa e sem rede, que transforma uma frase em um lançamento e
 * abre o formulário de sempre já preenchido. Ele NUNCA grava sozinho —
 * só o botão "Adicionar" do formulário grava (com as validações de sempre).
 */

const assert = require('assert');
const { startServer, launchBrowser, newPage, makeRunner } = require('./helpers');

// "Hoje" fixo nos testes de interpretação (15/11/2026), para não depender do dia em que rodam.
const CTX = `({
  cartoes:[{id:'c1',nome:'Nubank',venc:10},{id:'c2',nome:'Inter Black',venc:5}],
  categoriasCustom:[{id:'pet1',nome:'Pet',emoji:'🐶',cor:'#fff'}],
  hoje:new Date(2026,10,15), mes:10, ano:2026
})`;

async function main() {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchBrowser();
  const { test, report } = makeRunner();
  const page = await newPage(browser, baseUrl);
  const interp = (txt) => page.evaluate(([t, c]) => interpretarLancamento(t, eval(c)), [txt, CTX]);

  console.log('Lançar por texto — Conta Aí\n');

  await test('despesa variável simples com cartão e categoria', async () => {
    const r = await interp('gastei 50 no mercado no nubank');
    assert.strictEqual(r.tipo, 'variavel');
    assert.strictEqual(r.valor, 50);
    assert.strictEqual(r.cartaoId, 'c1');
    assert.strictEqual(r.cat, 'mercado');
    assert.strictEqual(r.desc, 'Mercado');
  });

  await test('"ontem", centavos e cartão pela primeira palavra do nome', async () => {
    const r = await interp('gastei 120,50 no posto ontem cartão inter');
    assert.strictEqual(r.valor, 120.5);
    assert.strictEqual(r.data, '2026-11-14');
    assert.strictEqual(r.dataExplicita, true);
    assert.strictEqual(r.cartaoId, 'c2');
    assert.strictEqual(r.cat, 'carro');
    assert.strictEqual(r.desc, 'Posto');
  });

  await test('parcelado: "em 10x" = valor total; "10x de 120" = valor da parcela', async () => {
    const a = await interp('comprei tv de 1200 em 10x no nubank');
    assert.strictEqual(a.parcQtd, 10);
    assert.strictEqual(a.parcModo, 'total');
    assert.strictEqual(a.valor, 1200);
    assert.strictEqual(a.desc, 'Tv');
    const b = await interp('geladeira 10x de 120');
    assert.strictEqual(b.parcQtd, 10);
    assert.strictEqual(b.parcModo, 'parcela');
    assert.strictEqual(b.valor, 120);
  });

  await test('receita com status e forma de recebimento', async () => {
    const r = await interp('recebi 3.000,00 de salário no pix');
    assert.strictEqual(r.tipo, 'ganho');
    assert.strictEqual(r.valor, 3000);
    assert.strictEqual(r.status, 'Recebido');
    assert.strictEqual(r.forma, 'conta');
    assert.strictEqual(r.desc, 'Salário');
  });

  await test('despesa fixa com vencimento e "conta" mantida na descrição', async () => {
    const r = await interp('conta de luz 180 fixa vence dia 10');
    assert.strictEqual(r.tipo, 'fixa');
    assert.strictEqual(r.venc, 10);
    assert.strictEqual(r.valor, 180);
    assert.strictEqual(r.cat, 'casa');
    assert.strictEqual(r.desc, 'Conta de luz');
  });

  await test('categoria personalizada tem prioridade e status "paguei" = Pago', async () => {
    const r = await interp('paguei 80 ração pet');
    assert.strictEqual(r.cat, 'pet1');
    assert.strictEqual(r.status, 'Pago');
  });

  await test('vários números: usa o maior e avisa', async () => {
    const r = await interp('2 pizzas 80');
    assert.strictEqual(r.valor, 80);
    assert.ok(r.avisos.some((a) => a.includes('mais de um número')));
  });

  await test('cartão citado mas não cadastrado gera aviso', async () => {
    const r = await interp('gastei 30 no cartão itau');
    assert.strictEqual(r.cartaoId, null);
    assert.ok(r.avisos.some((a) => a.includes('cartão')));
  });

  await test('preencher abre o formulário certo e NÃO grava nada sozinho', async () => {
    await page.evaluate(() => {
      cartoes.length = 0;
      cartoes.push({ id: 'c1', nome: 'Nubank', venc: 10, pagos: {} });
      DB.variaveis = [];
    });
    await page.evaluate(() => openModal('lancar-texto'));
    await page.fill('#lt-texto', 'gastei 45,90 farmácia hoje no nubank');
    await page.evaluate(() => lancarPorTexto());
    const estado = await page.evaluate(() => ({
      aberto: document.getElementById('modal-variaveis').classList.contains('open'),
      textoFechado: !document.getElementById('modal-lancar-texto').classList.contains('open'),
      desc: document.getElementById('v-desc').value,
      valor: document.getElementById('v-valor').value,
      cat: document.getElementById('v-cat').value,
      cartao: document.getElementById('v-cartao').value,
      aviso: !!document.querySelector('#modal-variaveis .lt-aviso'),
      gravados: DB.variaveis.length,
    }));
    assert.ok(estado.aberto && estado.textoFechado);
    assert.strictEqual(estado.desc, 'Farmácia');
    assert.strictEqual(estado.valor, '45.9');
    assert.strictEqual(estado.cat, 'saude');
    assert.strictEqual(estado.cartao, 'c1');
    assert.ok(estado.aviso, 'deveria mostrar o aviso de conferência');
    assert.strictEqual(estado.gravados, 0, 'não pode gravar antes do Adicionar');

    await page.evaluate(() => saveVariavel());
    const v = await page.evaluate(() => DB.variaveis);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].valor, 45.9);
    assert.strictEqual(v[0].cartaoId, 'c1');
  });

  await test('receita preenchida pelo texto salva pelo fluxo normal', async () => {
    await page.evaluate(() => { DB.ganhos = []; openModal('lancar-texto'); });
    await page.fill('#lt-texto', 'recebi 500 freela em dinheiro');
    await page.evaluate(() => lancarPorTexto());
    assert.strictEqual(await page.evaluate(() => DB.ganhos.length), 0);
    await page.evaluate(() => saveGanho());
    const g = await page.evaluate(() => DB.ganhos[0]);
    assert.strictEqual(g.valor, 500);
    assert.strictEqual(g.forma, 'especie');
    assert.strictEqual(g.status, 'Recebido');
  });

  await test('abrir o formulário pelo "+ Adicionar" depois não mostra aviso antigo', async () => {
    await page.evaluate(() => { closeModal('ganhos'); openModal('ganhos'); });
    assert.strictEqual(await page.evaluate(() => document.querySelectorAll('.lt-aviso').length), 0);
  });

  await test('texto sem nada reconhecível mostra erro e não abre formulário', async () => {
    await page.evaluate(() => { closeModal('ganhos'); openModal('lancar-texto'); });
    await page.fill('#lt-texto', 'de no');
    await page.evaluate(() => lancarPorTexto());
    const s = await page.evaluate(() => ({
      erro: document.getElementById('lt-erro').textContent,
      aindaAberto: document.getElementById('modal-lancar-texto').classList.contains('open'),
    }));
    assert.ok(s.erro.length > 0 && s.aindaAberto);
  });

  await page.close();
  await browser.close();
  server.close();
  process.exit(report() ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

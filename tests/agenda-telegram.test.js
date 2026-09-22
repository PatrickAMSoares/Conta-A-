#!/usr/bin/env node
/**
 * Testes da réplica em Node da lógica de ocorrências da "Agenda"
 * (scripts/lib/agenda.js), usada pelo script de avisos no Telegram.
 *
 * Achado real que motivou isso: um item cadastrado em "Agenda" com
 * vencimento hoje não gerava nenhum aviso, porque o script original só
 * lia Despesas Fixas e Variáveis — a Agenda é uma lista à parte, com
 * ocorrências calculadas na hora (não um lançamento por mês) e um ajuste
 * de "antecipa pro dia útil anterior" que Fixas/Variáveis não têm.
 *
 * Só Node puro, sem rede nem navegador.
 */

const assert = require('assert');
const { ocorrenciasDoMes, ocorrenciasParaAviso, _ajustaDiaUtil } = require('../scripts/lib/agenda');
const { diasEntre, itemPrecisaAviso } = require('../scripts/lib/vencimentos');

let passou = 0;
let falhou = 0;
function test(nome, fn) {
  try {
    fn();
    passou++;
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    falhou++;
    console.log(`  ✗ ${nome}`);
    console.log(`    ${e.message}`);
  }
}

console.log('Ocorrências da Agenda — avisos do Telegram\n');

test('_ajustaDiaUtil mantém a data quando já é dia útil', () => {
  assert.strictEqual(_ajustaDiaUtil('2026-03-05'), '2026-03-05'); // quinta-feira comum
});

test('_ajustaDiaUtil antecipa fim de semana pro dia útil anterior (sexta)', () => {
  assert.strictEqual(_ajustaDiaUtil('2026-01-03'), '2026-01-02'); // sábado -> sexta
  assert.strictEqual(_ajustaDiaUtil('2026-01-04'), '2026-01-02'); // domingo -> sexta
});

test('_ajustaDiaUtil antecipa feriado nacional, podendo cruzar pro mês/ano anterior', () => {
  assert.strictEqual(_ajustaDiaUtil('2026-01-01'), '2025-12-31'); // Ano Novo (quinta) -> quarta anterior
});

test('ocorrenciasDoMes: item único só aparece no mês/ano da sua data', () => {
  const agenda = [{ id: 'a1', tipo: 'unica', desc: 'Multa', valor: 100, data: '2026-03-10', pagos: {} }];
  assert.strictEqual(ocorrenciasDoMes(agenda, 2, 2026).length, 1); // março = mês 2 (0-based)
  assert.strictEqual(ocorrenciasDoMes(agenda, 3, 2026).length, 0); // abril
});

test('ocorrenciasDoMes: recorrente mensal gera uma ocorrência por mês a partir do início', () => {
  const agenda = [{ id: 'a2', tipo: 'recorrente', desc: 'Internet', valor: 120, dia: 5, intervalo: 1, inicio: '2026-01-01', fim: null, pagos: {} }];
  assert.strictEqual(ocorrenciasDoMes(agenda, 2, 2026).length, 1); // março
  assert.strictEqual(ocorrenciasDoMes(agenda, 0, 2025).length, 0); // antes de começar
});

test('ocorrenciasDoMes: recorrente bimestral só ocorre a cada 2 meses a partir do início', () => {
  const agenda = [{ id: 'a3', tipo: 'recorrente', desc: 'Seguro', valor: 300, dia: 5, intervalo: 2, inicio: '2026-01-01', fim: null, pagos: {} }];
  assert.strictEqual(ocorrenciasDoMes(agenda, 0, 2026).length, 1); // janeiro (diff 0) ocorre
  assert.strictEqual(ocorrenciasDoMes(agenda, 1, 2026).length, 0); // fevereiro (diff 1) não ocorre
  assert.strictEqual(ocorrenciasDoMes(agenda, 2, 2026).length, 1); // março (diff 2) ocorre
});

test('ocorrenciasDoMes: recorrente respeita o mês final (fim)', () => {
  const agenda = [{ id: 'a4', tipo: 'recorrente', desc: 'Curso', valor: 200, dia: 5, intervalo: 1, inicio: '2026-01-01', fim: '2026-02', pagos: {} }];
  assert.strictEqual(ocorrenciasDoMes(agenda, 1, 2026).length, 1); // fevereiro, dentro do prazo
  assert.strictEqual(ocorrenciasDoMes(agenda, 2, 2026).length, 0); // março, já passou do fim
});

test('ocorrenciasDoMes: dia 31 é limitado ao último dia de meses menores', () => {
  const agenda = [{ id: 'a5', tipo: 'recorrente', desc: 'Aluguel', valor: 1500, dia: 31, intervalo: 1, inicio: '2026-01-01', fim: null, pagos: {} }];
  const ocsAbril = ocorrenciasDoMes(agenda, 3, 2026); // abril tem 30 dias
  assert.strictEqual(ocsAbril[0].data <= '2026-04-30', true);
  assert.ok(ocsAbril[0].data.startsWith('2026-04-30') || ocsAbril[0].data < '2026-04-30');
});

test('ocorrenciasParaAviso: dispara para item único vencendo hoje', () => {
  const agenda = [{ id: 'a6', tipo: 'unica', desc: 'IPVA', valor: 800, data: '2026-03-05', pagos: {} }];
  const avisos = ocorrenciasParaAviso(agenda, '2026-03-05', 2, diasEntre, itemPrecisaAviso);
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].diff, 0);
  assert.strictEqual(avisos[0].desc, 'IPVA');
});

test('ocorrenciasParaAviso: não dispara de novo depois de marcado como pago (pagos por mês)', () => {
  const agenda = [{ id: 'a7', tipo: 'unica', desc: 'IPVA', valor: 800, data: '2026-03-05', pagos: { '2026-03': '05/03/2026' } }];
  const avisos = ocorrenciasParaAviso(agenda, '2026-03-05', 2, diasEntre, itemPrecisaAviso);
  assert.strictEqual(avisos.length, 0);
});

test('ocorrenciasParaAviso: dispara N dias antes para recorrente mensal', () => {
  const agenda = [{ id: 'a8', tipo: 'recorrente', desc: 'Condomínio', valor: 450, dia: 5, intervalo: 1, inicio: '2026-01-01', fim: null, pagos: {} }];
  const avisos = ocorrenciasParaAviso(agenda, '2026-03-02', 3, diasEntre, itemPrecisaAviso);
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].diff, 3);
});

test('ocorrenciasParaAviso: não dispara em dias fora da janela (nem antes, nem depois)', () => {
  const agenda = [{ id: 'a9', tipo: 'recorrente', desc: 'Condomínio', valor: 450, dia: 20, intervalo: 1, inicio: '2026-01-01', fim: null, pagos: {} }];
  const avisos = ocorrenciasParaAviso(agenda, '2026-03-02', 2, diasEntre, itemPrecisaAviso);
  assert.strictEqual(avisos.length, 0);
});

test('ocorrenciasParaAviso: considera o ajuste de dia útil ao calcular a diferença de dias', () => {
  // Vencimento nominal 03/01/2026 (sábado) -> antecipado para 02/01/2026 (sexta)
  const agenda = [{ id: 'a10', tipo: 'unica', desc: 'Fatura', valor: 200, data: '2026-01-03', pagos: {} }];
  const avisos = ocorrenciasParaAviso(agenda, '2026-01-02', 0, diasEntre, itemPrecisaAviso);
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].data, '2026-01-02');
});

test('ocorrenciasParaAviso: olha também o mês seguinte, pra não perder vencimento perto da virada', () => {
  const agenda = [{ id: 'a11', tipo: 'recorrente', desc: 'Manutenção', valor: 90, dia: 1, intervalo: 1, inicio: '2026-01-01', fim: null, pagos: {} }];
  // Hoje é 29/05 (sexta), avisando 3 dias antes -> vencimento é 01/06, já no mês seguinte
  const avisos = ocorrenciasParaAviso(agenda, '2026-05-29', 3, diasEntre, itemPrecisaAviso);
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].data, '2026-06-01');
  assert.strictEqual(avisos[0].diff, 3);
});

console.log(`\n${passou}/${passou + falhou} testes passaram.`);
if (falhou) {
  process.exit(1);
}

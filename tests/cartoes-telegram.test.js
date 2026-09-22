#!/usr/bin/env node
/**
 * Testes da "fatura única por cartão" usada pelo script de avisos no
 * Telegram (scripts/lib/cartoes.js): soma as Despesas Variáveis de um
 * cartão num mês e trata isso como um vencimento só, no dia cadastrado no
 * cartão. Só Node puro, sem rede nem navegador.
 */

const assert = require('assert');
const { ocorrenciasCartoesDoMes, ocorrenciasCartoesParaAviso } = require('../scripts/lib/cartoes');
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

console.log('Fatura única por cartão — avisos do Telegram\n');

test('ocorrenciasCartoesDoMes soma as variáveis do cartão naquele mês', () => {
  const cartoes = [{ id: 'c1', nome: 'Nubank', venc: 10, pagos: {} }];
  const variaveis = [
    { cartaoId: 'c1', valor: 50, m: 2, y: 2026 },
    { cartaoId: 'c1', valor: 30, m: 2, y: 2026 },
    { cartaoId: 'c1', valor: 999, m: 3, y: 2026 }, // outro mês, não entra
    { cartaoId: 'c2', valor: 999, m: 2, y: 2026 }, // outro cartão, não entra
  ];
  const ocs = ocorrenciasCartoesDoMes(cartoes, variaveis, 2, 2026); // março
  assert.strictEqual(ocs.length, 1);
  assert.strictEqual(ocs[0].valor, 80);
  assert.strictEqual(ocs[0].data, '2026-03-10');
  assert.strictEqual(ocs[0].desc, 'Fatura Nubank');
});

test('ocorrenciasCartoesDoMes ignora cartão sem vencimento cadastrado', () => {
  const cartoes = [{ id: 'c1', nome: 'Sem venc', venc: null, pagos: {} }];
  const variaveis = [{ cartaoId: 'c1', valor: 50, m: 2, y: 2026 }];
  assert.strictEqual(ocorrenciasCartoesDoMes(cartoes, variaveis, 2, 2026).length, 0);
});

test('ocorrenciasCartoesDoMes não gera nada quando não há despesas naquele mês', () => {
  const cartoes = [{ id: 'c1', nome: 'Nubank', venc: 10, pagos: {} }];
  assert.strictEqual(ocorrenciasCartoesDoMes(cartoes, [], 2, 2026).length, 0);
});

test('ocorrenciasCartoesDoMes ajusta o dia em meses menores (dia 31 em abril)', () => {
  const cartoes = [{ id: 'c1', nome: 'Inter', venc: 31, pagos: {} }];
  const variaveis = [{ cartaoId: 'c1', valor: 10, m: 3, y: 2026 }]; // abril, 30 dias
  const ocs = ocorrenciasCartoesDoMes(cartoes, variaveis, 3, 2026);
  assert.strictEqual(ocs[0].data, '2026-04-30');
});

test('ocorrenciasCartoesDoMes antecipa vencimento em fim de semana/feriado', () => {
  const cartoes = [{ id: 'c1', nome: 'Nubank', venc: 3, pagos: {} }]; // 3/1/2026 é sábado
  const variaveis = [{ cartaoId: 'c1', valor: 10, m: 0, y: 2026 }];
  const ocs = ocorrenciasCartoesDoMes(cartoes, variaveis, 0, 2026);
  assert.strictEqual(ocs[0].data, '2026-01-02'); // antecipa pra sexta
});

test('ocorrenciasCartoesDoMes respeita a fatura já marcada como paga naquele mês', () => {
  const cartoes = [{ id: 'c1', nome: 'Nubank', venc: 10, pagos: { '2026-03': '05/03/2026' } }];
  const variaveis = [{ cartaoId: 'c1', valor: 50, m: 2, y: 2026 }];
  const ocs = ocorrenciasCartoesDoMes(cartoes, variaveis, 2, 2026);
  assert.strictEqual(ocs[0].pago, true);
});

test('ocorrenciasCartoesParaAviso dispara para fatura vencendo hoje', () => {
  const cartoes = [{ id: 'c1', nome: 'Nubank', venc: 5, pagos: {} }];
  const variaveis = [{ cartaoId: 'c1', valor: 200, m: 2, y: 2026 }];
  const avisos = ocorrenciasCartoesParaAviso(cartoes, variaveis, '2026-03-05', 2, diasEntre, itemPrecisaAviso);
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].diff, 0);
  assert.strictEqual(avisos[0].valor, 200);
});

test('ocorrenciasCartoesParaAviso não dispara de novo depois de a fatura ser marcada como paga', () => {
  const cartoes = [{ id: 'c1', nome: 'Nubank', venc: 5, pagos: { '2026-03': '05/03/2026' } }];
  const variaveis = [{ cartaoId: 'c1', valor: 200, m: 2, y: 2026 }];
  const avisos = ocorrenciasCartoesParaAviso(cartoes, variaveis, '2026-03-05', 2, diasEntre, itemPrecisaAviso);
  assert.strictEqual(avisos.length, 0);
});

test('ocorrenciasCartoesParaAviso soma faturas de cartões diferentes separadamente', () => {
  const cartoes = [
    { id: 'c1', nome: 'Nubank', venc: 5, pagos: {} },
    { id: 'c2', nome: 'Inter', venc: 5, pagos: {} },
  ];
  const variaveis = [
    { cartaoId: 'c1', valor: 100, m: 2, y: 2026 },
    { cartaoId: 'c2', valor: 300, m: 2, y: 2026 },
  ];
  const avisos = ocorrenciasCartoesParaAviso(cartoes, variaveis, '2026-03-05', 0, diasEntre, itemPrecisaAviso);
  assert.strictEqual(avisos.length, 2);
  assert.deepStrictEqual(avisos.map((a) => a.valor).sort((a, b) => a - b), [100, 300]);
});

console.log(`\n${passou}/${passou + falhou} testes passaram.`);
if (falhou) {
  process.exit(1);
}

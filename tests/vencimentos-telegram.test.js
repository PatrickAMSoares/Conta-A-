#!/usr/bin/env node
/**
 * Testes da lógica pura de "quando avisar" usada pelo script de avisos no
 * Telegram (scripts/lib/vencimentos.js). Não precisa de navegador, rede
 * nem credenciais — só Node puro, então roda rápido e sem tocar em nada
 * real (Firestore, Telegram etc.).
 */

const assert = require('assert');
const { diasEntre, dataFixaISO, itemPrecisaAviso } = require('../scripts/lib/vencimentos');

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

console.log('Lógica de avisos do Telegram\n');

test('diasEntre calcula a diferença em dias entre duas datas ISO', () => {
  assert.strictEqual(diasEntre('2026-03-01', '2026-03-05'), 4);
  assert.strictEqual(diasEntre('2026-03-05', '2026-03-01'), -4);
  assert.strictEqual(diasEntre('2026-03-05', '2026-03-05'), 0);
});

test('diasEntre atravessa virada de mês corretamente', () => {
  assert.strictEqual(diasEntre('2026-02-27', '2026-03-01'), 2); // 2026 não é bissexto
});

test('dataFixaISO monta a data a partir de venc (dia) + m (0-based) + y', () => {
  assert.strictEqual(dataFixaISO({ venc: 10, m: 0, y: 2026 }), '2026-01-10');
  assert.strictEqual(dataFixaISO({ venc: '5', m: 11, y: 2026 }), '2026-12-05');
});

test('dataFixaISO retorna null quando faltam dados', () => {
  assert.strictEqual(dataFixaISO({ venc: null, m: 0, y: 2026 }), null);
  assert.strictEqual(dataFixaISO({ venc: 10, m: null, y: 2026 }), null);
  assert.strictEqual(dataFixaISO({}), null);
});

test('itemPrecisaAviso dispara exatamente nos dias de antecedência e no vencimento', () => {
  assert.strictEqual(itemPrecisaAviso(2, 2), true);
  assert.strictEqual(itemPrecisaAviso(0, 2), true);
  assert.strictEqual(itemPrecisaAviso(1, 2), false);
  assert.strictEqual(itemPrecisaAviso(3, 2), false);
  assert.strictEqual(itemPrecisaAviso(-1, 2), false); // já vencido — script não repete aviso
});

console.log(`\n${passou}/${passou + falhou} testes passaram.`);
if (falhou) {
  process.exit(1);
}

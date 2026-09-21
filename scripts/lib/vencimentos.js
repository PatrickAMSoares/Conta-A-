// Lógica pura (sem rede, sem Firestore) usada para decidir quando um
// lançamento merece um aviso de vencimento. Fica separada do script
// principal (scripts/enviar-avisos-telegram.js) só para poder ser testada
// isoladamente, sem precisar de credenciais nem de acesso à internet.

function diasEntre(dataISOa, dataISOb) {
  const a = new Date(dataISOa + 'T00:00:00');
  const b = new Date(dataISOb + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

// Despesas fixas guardam só o dia do vencimento (venc) e o mês/ano do
// lançamento (m 0-based, y) — não uma data completa como as variáveis.
function dataFixaISO(item) {
  const dia = parseInt(item && item.venc, 10);
  if (!dia || item.y == null || item.m == null) return null;
  return item.y + '-' + String(item.m + 1).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
}

// Dispara exatamente no dia configurado de antecedência e no próprio dia
// do vencimento — nunca nos dias entre um e outro, para não repetir o
// aviso todo dia até a conta ser paga.
function itemPrecisaAviso(diasParaVencer, diasAntes) {
  return diasParaVencer === diasAntes || diasParaVencer === 0;
}

module.exports = { diasEntre, dataFixaISO, itemPrecisaAviso };

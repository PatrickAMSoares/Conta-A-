// Réplica em Node do cálculo de "fatura do cartão" como item único de
// vencimento (index.html, _ocorrenciasCartoesDoMes): soma tudo que foi
// lançado num cartão num mês e trata isso como um vencimento só, no dia
// cadastrado no cartão — com o mesmo ajuste de dia útil usado na Agenda.
// Não é um documento salvo, é calculado a partir de Despesas Variáveis.

const { _ajustaDiaUtil } = require('./agenda');

function _somaVariaveisPorCartaoMes(variaveis, cartaoId, m, y) {
  return (variaveis || [])
    .filter((v) => v.cartaoId === cartaoId && v.m === m && v.y === y)
    .reduce((a, b) => a + (b.valor || 0), 0);
}

function ocorrenciasCartoesDoMes(cartoes, variaveis, m, y) {
  const out = [];
  (cartoes || []).forEach((c) => {
    if (!c.venc) return;
    const soma = _somaVariaveisPorCartaoMes(variaveis, c.id, m, y);
    if (soma <= 0) return;
    const ultimo = new Date(y, m + 1, 0).getDate();
    const dia = Math.min(c.venc, ultimo);
    const isoOrig = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
    const ajust = _ajustaDiaUtil(isoOrig);
    const chave = isoOrig.slice(0, 7);
    const pago = !!(c.pagos && c.pagos[chave]);
    out.push({ cartao: c, desc: 'Fatura ' + c.nome, valor: soma, data: ajust, chave, pago });
  });
  return out;
}

// Mesma janela usada para Agenda: mês atual + mês seguinte, o suficiente
// dado que "dias de antecedência" vai no máximo até 15 no app.
function ocorrenciasCartoesParaAviso(cartoes, variaveis, hojeISO, diasAntes, diasEntreFn, itemPrecisaAvisoFn) {
  const [y, mm] = hojeISO.split('-').map(Number);
  const m0 = mm - 1;
  const meses = [{ y, m: m0 }, m0 === 11 ? { y: y + 1, m: 0 } : { y, m: m0 + 1 }];

  const avisos = [];
  meses.forEach(({ y: yy, m: mesN }) => {
    ocorrenciasCartoesDoMes(cartoes, variaveis, mesN, yy).forEach((oc) => {
      if (oc.pago) return;
      const diff = diasEntreFn(hojeISO, oc.data);
      if (itemPrecisaAvisoFn(diff, diasAntes)) {
        avisos.push({ desc: oc.desc, valor: oc.valor, data: oc.data, diff });
      }
    });
  });
  return avisos;
}

module.exports = { ocorrenciasCartoesDoMes, ocorrenciasCartoesParaAviso };

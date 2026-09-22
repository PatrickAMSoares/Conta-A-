// Réplica em Node da lógica de ocorrências da "Agenda" (index.html, seção
// "AGENDA: OCORRÊNCIAS") — precisa se comportar EXATAMENTE como no app
// (mesmos feriados, mesmo ajuste para dia útil), senão o aviso no Telegram
// cairia num dia diferente do que a tela "Agenda" mostra pro usuário.
//
// Diferente de Despesas Fixas/Variáveis, um item da Agenda não é um
// lançamento por mês: é uma regra (única ou recorrente) da qual as
// ocorrências de cada mês são calculadas na hora, e o vencimento pode ser
// antecipado se cair num fim de semana ou feriado nacional.

const _cacheFer = {};

function _pascoa(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * mm + 114) / 31), dia = ((h + l - 7 * mm + 114) % 31) + 1;
  return new Date(y, mes - 1, dia);
}
function _md(d) { return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function _somaDias(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

function _feriados(y) {
  if (_cacheFer[y]) return _cacheFer[y];
  const s = new Set(['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25']);
  if (y >= 2024) s.add('11-20'); // Consciência Negra
  const p = _pascoa(y);
  s.add(_md(_somaDias(p, -48))); // Carnaval (seg)
  s.add(_md(_somaDias(p, -47))); // Carnaval (ter)
  s.add(_md(_somaDias(p, -2)));  // Sexta-feira Santa
  s.add(_md(_somaDias(p, 60)));  // Corpus Christi
  _cacheFer[y] = s;
  return s;
}

function _ehDiaUtil(dt) {
  const w = dt.getDay();
  if (w === 0 || w === 6) return false;
  return !_feriados(dt.getFullYear()).has(_md(dt));
}

function _isoDe(dt) {
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

// Antecipa para o dia útil anterior (mesma regra do app).
function _ajustaDiaUtil(iso) {
  const p = String(iso).split('-').map(Number);
  let dt = new Date(p[0], p[1] - 1, p[2]);
  let guarda = 0;
  while (!_ehDiaUtil(dt) && guarda++ < 20) dt.setDate(dt.getDate() - 1);
  return _isoDe(dt);
}

function _mesesEntre(y1, m1, y2, m2) { return (y2 - y1) * 12 + (m2 - m1); }

function _montaOc(item, isoOrig) {
  const ajust = _ajustaDiaUtil(isoOrig);
  const chave = isoOrig.slice(0, 7);
  const pago = !!(item.pagos && item.pagos[chave]);
  return { item, data: ajust, pago, chave };
}

// m é 0-based (janeiro = 0), igual ao resto do app.
function ocorrenciasDoMes(agendaItems, m, y) {
  const out = [];
  (agendaItems || []).forEach((a) => {
    if (a.tipo === 'unica') {
      if (!a.data) return;
      if (+a.data.slice(0, 4) === y && +a.data.slice(5, 7) - 1 === m) out.push(_montaOc(a, a.data));
      return;
    }
    if (!a.inicio) return;
    const iy = +a.inicio.slice(0, 4), im = +a.inicio.slice(5, 7) - 1;
    const diff = _mesesEntre(iy, im, y, m);
    if (diff < 0) return;
    const inter = a.intervalo || 1;
    if (diff % inter !== 0) return;
    if (a.fim) {
      const fy = +a.fim.slice(0, 4), fm = +a.fim.slice(5, 7) - 1;
      if (_mesesEntre(iy, im, fy, fm) < diff) return;
    }
    const ultimo = new Date(y, m + 1, 0).getDate();
    const dia = Math.min(a.dia || 1, ultimo);
    out.push(_montaOc(a, y + '-' + String(m + 1).padStart(2, '0') + '-' + String(dia).padStart(2, '0')));
  });
  return out;
}

// Ocorrências não pagas de hoje até "diasAntes" dias à frente — olha o mês
// atual e o seguinte (suficiente mesmo perto da virada do mês, já que o
// app limita "dias de antecedência" a no máximo 15).
function ocorrenciasParaAviso(agendaItems, hojeISO, diasAntes, diasEntreFn, itemPrecisaAvisoFn) {
  const [y, mm] = hojeISO.split('-').map(Number);
  const m0 = mm - 1;
  const meses = [{ y, m: m0 }, m0 === 11 ? { y: y + 1, m: 0 } : { y, m: m0 + 1 }];

  const vistos = new Set();
  const avisos = [];
  meses.forEach(({ y: yy, m: mesN }) => {
    ocorrenciasDoMes(agendaItems, mesN, yy).forEach((oc) => {
      if (oc.pago) return;
      const chaveVista = oc.item.id + '|' + oc.chave;
      if (vistos.has(chaveVista)) return;
      vistos.add(chaveVista);
      const diff = diasEntreFn(hojeISO, oc.data);
      if (itemPrecisaAvisoFn(diff, diasAntes)) {
        avisos.push({ desc: oc.item.desc, valor: oc.item.valor, data: oc.data, diff });
      }
    });
  });
  return avisos;
}

module.exports = { ocorrenciasDoMes, ocorrenciasParaAviso, _ajustaDiaUtil, _feriados };

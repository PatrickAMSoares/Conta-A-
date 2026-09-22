#!/usr/bin/env node
/**
 * Envia avisos no Telegram para despesas (Fixas, Variáveis, Agenda e
 * faturas de Cartão) perto de vencer. Roda agendado via GitHub Actions
 * (.github/workflows/avisos-telegram.yml) — o app em si (index.html) é só
 * HTML/CSS/JS estático, sem servidor, então esse script é quem
 * efetivamente dispara as mensagens fora do navegador do usuário.
 *
 * Despesas Variáveis num cartão com vencimento cadastrado não avisam
 * individualmente: entram somadas numa "fatura" única do cartão (mesmo
 * cálculo do app, replicado em lib/cartoes.js), pra não duplicar o aviso.
 *
 * Segredos necessários (GitHub Actions secrets do repositório — NUNCA
 * commitados no código):
 *   TELEGRAM_BOT_TOKEN        — token do bot, gerado pelo @BotFather
 *   FIREBASE_SERVICE_ACCOUNT  — conteúdo JSON da chave de conta de
 *                               serviço do Firebase (Console do Firebase
 *                               → Configurações do projeto → Contas de
 *                               serviço → Gerar nova chave privada)
 *
 * Não lê nem grava nenhum dado além do necessário para montar os avisos:
 * só lê financas/{uid} (para prefs.telegram* e cartoes) e as subcoleções
 * fixas/variaveis/agenda de cada plano. Não altera nenhum lançamento
 * existente.
 */

const admin = require('firebase-admin');
const { diasEntre, dataFixaISO, itemPrecisaAviso } = require('./lib/vencimentos');
const { ocorrenciasParaAviso } = require('./lib/agenda');
const { ocorrenciasCartoesParaAviso } = require('./lib/cartoes');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!BOT_TOKEN || !SERVICE_ACCOUNT_JSON) {
  console.error('Faltam as variáveis de ambiente TELEGRAM_BOT_TOKEN e/ou FIREBASE_SERVICE_ACCOUNT.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(SERVICE_ACCOUNT_JSON)),
});
const db = admin.firestore();

function hojeISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function enviarMensagemTelegram(chatId, texto) {
  const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML' }),
  });
  const json = await resp.json();
  if (!json.ok) console.error('Falha ao enviar Telegram:', json.description);
  return json.ok;
}

function coletarAvisos(fixas, variaveis, agenda, cartoes, hoje, diasAntes) {
  const avisos = [];
  // Despesas num cartão com vencimento cadastrado já entram somadas na
  // "fatura" única do cartão (ocorrenciasCartoesParaAviso) — sem isso, o
  // mesmo gasto avisaria duas vezes: uma vez sozinho, outra dentro da soma.
  const cartoesComVenc = new Set((cartoes || []).filter((c) => c.venc).map((c) => c.id));

  fixas.forEach((item) => {
    if (item.status === 'Pago') return;
    const dataISO = dataFixaISO(item);
    if (!dataISO) return;
    const diff = diasEntre(hoje, dataISO);
    if (itemPrecisaAviso(diff, diasAntes)) avisos.push({ desc: item.desc, valor: item.valor, data: dataISO, diff });
  });

  variaveis.forEach((item) => {
    if (item.status === 'Pago' || !item.data) return;
    if (item.cartaoId && cartoesComVenc.has(item.cartaoId)) return;
    const diff = diasEntre(hoje, item.data);
    if (itemPrecisaAviso(diff, diasAntes)) avisos.push({ desc: item.desc, valor: item.valor, data: item.data, diff });
  });

  avisos.push(...ocorrenciasParaAviso(agenda, hoje, diasAntes, diasEntre, itemPrecisaAviso));
  avisos.push(...ocorrenciasCartoesParaAviso(cartoes, variaveis, hoje, diasAntes, diasEntre, itemPrecisaAviso));

  return avisos;
}

// Diagnóstico: não decide nada, só ajuda a entender por que "avisos" deu
// zero — sem imprimir descrição, valor nem data completa de nada.
function diagnosticar(fixas, variaveis, hoje) {
  let menorDiffAbs = null;
  let semData = 0;
  let totalNaoPago = 0;

  function registra(diff) {
    if (menorDiffAbs === null || Math.abs(diff) < Math.abs(menorDiffAbs)) menorDiffAbs = diff;
  }

  fixas.forEach((item) => {
    if (item.status === 'Pago') return;
    totalNaoPago++;
    const dataISO = dataFixaISO(item);
    if (!dataISO) { semData++; return; }
    registra(diasEntre(hoje, dataISO));
  });

  variaveis.forEach((item) => {
    if (item.status === 'Pago') return;
    totalNaoPago++;
    if (!item.data) { semData++; return; }
    registra(diasEntre(hoje, item.data));
  });

  return { menorDiffAbs, semData, totalNaoPago };
}

// Idem, mas cobrindo a chance de zero avisos vir de *só* ter olhado
// fixas/variáveis (a Agenda é um outro formato: ocorrências calculadas na
// hora, não lançamentos avulsos).
function diagnosticarAgenda(agenda) {
  const unicas = agenda.filter((a) => a.tipo === 'unica').length;
  const recorrentes = agenda.filter((a) => a.tipo !== 'unica').length;
  return { total: agenda.length, unicas, recorrentes };
}

function montarMensagem(titulo, avisos) {
  const linhas = avisos.map((a) => {
    const [, m, dd] = a.data.split('-');
    const quando = a.diff === 0 ? 'vence hoje' : `vence em ${a.diff} dia${a.diff > 1 ? 's' : ''} (${dd}/${m})`;
    const valor = 'R$ ' + Number(a.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `• ${a.desc} — ${valor} — ${quando}`;
  });
  return `📋 <b>${titulo}</b>\nContas perto de vencer:\n\n${linhas.join('\n')}`;
}

async function main() {
  const hoje = hojeISO();
  console.log('Data de hoje (calculada no servidor do GitHub Actions, em UTC):', hoje);

  const financasSnap = await db.collection('financas').get();
  console.log(`Encontrado(s) ${financasSnap.size} plano(s) na coleção "financas".`);
  let totalEnviados = 0;

  for (const planoDoc of financasSnap.docs) {
    const plano = planoDoc.data();
    const prefs = plano.prefs || {};
    // Só o necessário para depurar, sem expor o chat ID nem nenhum dado do lançamento.
    console.log(
      `Plano ${planoDoc.id}: telegramAtivo=${!!prefs.telegramAtivo}, temChatId=${!!prefs.telegramChatId}, diasAntes=${prefs.telegramDiasAntes}`
    );
    if (!prefs.telegramAtivo || !prefs.telegramChatId) continue;
    const diasAntes = Number.isFinite(prefs.telegramDiasAntes) ? prefs.telegramDiasAntes : 2;

    const [fixasSnap, variaveisSnap, agendaSnap] = await Promise.all([
      planoDoc.ref.collection('fixas').get(),
      planoDoc.ref.collection('variaveis').get(),
      planoDoc.ref.collection('agenda').get(),
    ]);
    console.log(
      `  Fixas: ${fixasSnap.size} lançamento(s). Variáveis: ${variaveisSnap.size} lançamento(s). Agenda: ${agendaSnap.size} item(ns).`
    );

    const agendaItems = agendaSnap.docs.map((d) => d.data());
    const variaveisItems = variaveisSnap.docs.map((d) => d.data());
    const cartoesDoPlano = plano.cartoes || [];
    const avisos = coletarAvisos(
      fixasSnap.docs.map((d) => d.data()),
      variaveisItems,
      agendaItems,
      cartoesDoPlano,
      hoje,
      diasAntes
    );
    console.log(`  Avisos encontrados para esse plano: ${avisos.length}.`);
    if (!avisos.length) {
      const diag = diagnosticar(
        fixasSnap.docs.map((d) => d.data()),
        variaveisItems,
        hoje
      );
      const diagAg = diagnosticarAgenda(agendaItems);
      const comVenc = cartoesDoPlano.filter((c) => c.venc).length;
      console.log(
        `  Diagnóstico: ${diag.totalNaoPago} lançamento(s) não pagos, ${diag.semData} sem data válida, menor diferença de dias até um vencimento = ${diag.menorDiffAbs}. Agenda: ${diagAg.total} item(ns) (${diagAg.unicas} única(s), ${diagAg.recorrentes} recorrente(s)). Cartões: ${cartoesDoPlano.length} (${comVenc} com vencimento cadastrado).`
      );
      continue;
    }

    const texto = montarMensagem(plano.planTitle || 'Conta Aí', avisos);
    const ok = await enviarMensagemTelegram(prefs.telegramChatId, texto);
    if (ok) totalEnviados++;
  }

  console.log(`Avisos enviados para ${totalEnviados} plano(s).`);
}

main().catch((e) => {
  console.error('Erro ao enviar avisos do Telegram:', e);
  process.exit(1);
});

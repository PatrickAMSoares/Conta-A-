#!/usr/bin/env node
/**
 * Envia avisos no Telegram para despesas (Fixas e Variáveis) perto de
 * vencer. Roda agendado via GitHub Actions (.github/workflows/
 * avisos-telegram.yml) — o app em si (index.html) é só HTML/CSS/JS
 * estático, sem servidor, então esse script é quem efetivamente dispara
 * as mensagens fora do navegador do usuário.
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
 * só lê financas/{uid} (para prefs.telegram*) e as subcoleções fixas/
 * variaveis de cada plano. Não altera nenhum lançamento existente.
 */

const admin = require('firebase-admin');
const { diasEntre, dataFixaISO, itemPrecisaAviso } = require('./lib/vencimentos');

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

function coletarAvisos(fixas, variaveis, hoje, diasAntes) {
  const avisos = [];

  fixas.forEach((item) => {
    if (item.status === 'Pago') return;
    const dataISO = dataFixaISO(item);
    if (!dataISO) return;
    const diff = diasEntre(hoje, dataISO);
    if (itemPrecisaAviso(diff, diasAntes)) avisos.push({ desc: item.desc, valor: item.valor, data: dataISO, diff });
  });

  variaveis.forEach((item) => {
    if (item.status === 'Pago' || !item.data) return;
    const diff = diasEntre(hoje, item.data);
    if (itemPrecisaAviso(diff, diasAntes)) avisos.push({ desc: item.desc, valor: item.valor, data: item.data, diff });
  });

  return avisos;
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
  const financasSnap = await db.collection('financas').get();
  let totalEnviados = 0;

  for (const planoDoc of financasSnap.docs) {
    const plano = planoDoc.data();
    const prefs = plano.prefs || {};
    if (!prefs.telegramAtivo || !prefs.telegramChatId) continue;
    const diasAntes = Number.isFinite(prefs.telegramDiasAntes) ? prefs.telegramDiasAntes : 2;

    const [fixasSnap, variaveisSnap] = await Promise.all([
      planoDoc.ref.collection('fixas').get(),
      planoDoc.ref.collection('variaveis').get(),
    ]);

    const avisos = coletarAvisos(
      fixasSnap.docs.map((d) => d.data()),
      variaveisSnap.docs.map((d) => d.data()),
      hoje,
      diasAntes
    );
    if (!avisos.length) continue;

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

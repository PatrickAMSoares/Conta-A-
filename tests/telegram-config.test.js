#!/usr/bin/env node
/**
 * Testes da configuração de avisos no Telegram (modal "Avisos no
 * Telegram" dentro de Configurações). Cobre o toggle de ativação, a
 * abertura da página de busca do chat ID (a API do Telegram não manda
 * cabeçalho de CORS, então isso é feito abrindo uma aba nova — uma
 * navegação normal do navegador — em vez de um fetch() de dentro do app;
 * nenhuma rede real acontece no teste, só confere a URL aberta) e a
 * validação/persistência ao salvar.
 */

const assert = require('assert');
const { startServer, launchBrowser, newPage, makeRunner } = require('./helpers');

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();
  const { test, report } = makeRunner();

  console.log('Configuração de avisos no Telegram — Conta Aí\n');

  await test('o toggle "Ativar avisos" mostra/esconde os campos de configuração', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('telegram'));
    const escondidoNoInicio = await page.locator('#tg-opts').isHidden();
    await page.check('#tg-ativo');
    const visivelDepois = await page.locator('#tg-opts').isVisible();
    assert.ok(escondidoNoInicio, 'os campos deveriam começar escondidos (avisos desativados por padrão)');
    assert.ok(visivelDepois, 'os campos deveriam aparecer ao marcar "Ativar avisos"');
    await page.close();
  });

  await test('abrirPaginaChatId sem token avisa e não abre nenhuma aba', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('telegram'));
    await page.check('#tg-ativo');
    let abriuPopup = false;
    page.once('popup', () => { abriuPopup = true; });
    await page.evaluate(() => abrirPaginaChatId());
    await page.waitForTimeout(150);
    const status = await page.locator('#tg-status').innerText();
    assert.ok(status.includes('token'), 'deveria pedir pra colar o token primeiro');
    assert.strictEqual(abriuPopup, false);
    await page.close();
  });

  await test('abrirPaginaChatId com token abre a URL certa da API do Telegram numa aba nova', async () => {
    const page = await newPage(browser, baseUrl);
    // Intercepta a navegação (sem rede real) só pra conseguir inspecionar a
    // URL que a aba nova tentou abrir, sem depender de internet de verdade.
    await page.context().route('https://api.telegram.org/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"result":[]}' });
    });
    await page.evaluate(() => openModal('telegram'));
    await page.check('#tg-ativo');
    await page.fill('#tg-token', 'token-de-teste-123');
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.click('text=🔎 Abrir página com meu código'),
    ]);
    await popup.waitForLoadState('load');
    assert.strictEqual(popup.url(), 'https://api.telegram.org/bottoken-de-teste-123/getUpdates');
    await popup.close();
    const tokenDepois = await page.inputValue('#tg-token');
    const status = await page.locator('#tg-status').innerText();
    assert.strictEqual(tokenDepois, '', 'o token não deve continuar no campo depois de usado');
    assert.ok(status.includes('chat'), 'deveria orientar o usuário a procurar "chat":{"id":...} na página aberta');
    await page.close();
  });

  await test('salvarTelegram recusa ativar sem um chat ID vinculado', async () => {
    const page = await newPage(browser, baseUrl);
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.evaluate(() => openModal('telegram'));
    await page.check('#tg-ativo');
    await page.evaluate(() => salvarTelegram());
    await page.waitForTimeout(100);
    const ativo = await page.evaluate(() => telegramAtivo);
    assert.strictEqual(ativo, false, 'não deveria ativar sem chat ID');
    assert.ok(dialogs.length >= 1, 'deveria explicar que falta vincular o Telegram');
    await page.close();
  });

  await test('salvarTelegram persiste ativo/chatId/diasAntes em memória (o que a sincronização com o Firestore então grava)', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => openModal('telegram'));
    await page.check('#tg-ativo');
    await page.fill('#tg-chatid', '123456789');
    await page.fill('#tg-dias', '3');
    await page.evaluate(() => salvarTelegram());
    await page.waitForTimeout(100);
    const estado = await page.evaluate(() => ({ ativo: telegramAtivo, chatId: telegramChatId, dias: telegramDiasAntes, prefs: getPrefs() }));
    assert.strictEqual(estado.ativo, true);
    assert.strictEqual(estado.chatId, '123456789');
    assert.strictEqual(estado.dias, 3);
    assert.strictEqual(estado.prefs.telegramAtivo, true);
    assert.strictEqual(estado.prefs.telegramChatId, '123456789');
    assert.strictEqual(estado.prefs.telegramDiasAntes, 3);
    const subtitulo = await page.locator('#settings-telegram-sub').innerText();
    assert.strictEqual(subtitulo, 'Ativado');
    await page.close();
  });

  await test('desativar (sem chat ID) é sempre permitido, mesmo tendo vinculado antes', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { telegramAtivo = true; telegramChatId = '111'; telegramDiasAntes = 5; });
    await page.evaluate(() => openModal('telegram'));
    await page.uncheck('#tg-ativo');
    await page.evaluate(() => salvarTelegram());
    await page.waitForTimeout(100);
    const ativo = await page.evaluate(() => telegramAtivo);
    assert.strictEqual(ativo, false);
    await page.close();
  });

  await test('applyPrefs restaura as preferências de Telegram salvas (ex.: ao reabrir o app)', async () => {
    const page = await newPage(browser, baseUrl);
    const prefs = await page.evaluate(() => {
      applyPrefs({ theme: 'dark', telegramAtivo: true, telegramChatId: '555', telegramDiasAntes: 4 });
      return { ativo: telegramAtivo, chatId: telegramChatId, dias: telegramDiasAntes };
    });
    assert.deepStrictEqual(prefs, { ativo: true, chatId: '555', dias: 4 });
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

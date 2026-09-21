#!/usr/bin/env node
/**
 * Testes da configuração de avisos no Telegram (modal "Avisos no
 * Telegram" dentro de Configurações). Cobre o toggle de ativação, a
 * busca automática do chat ID (com a chamada à API do Telegram
 * interceptada — nenhuma rede real, nenhum token real é usado) e a
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

  await test('descobrirChatIdTelegram preenche o chat ID a partir da resposta do Telegram (rede simulada)', async () => {
    const page = await newPage(browser, baseUrl);
    await page.route('https://api.telegram.org/**/getUpdates', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: [{ message: { chat: { id: 999888777 } } }] }),
      });
    });
    await page.evaluate(() => openModal('telegram'));
    await page.check('#tg-ativo');
    await page.fill('#tg-token', 'token-de-teste-123');
    await page.click('text=🔎 Buscar meu código de vínculo');
    await page.waitForTimeout(200);
    const chatId = await page.inputValue('#tg-chatid');
    const tokenDepois = await page.inputValue('#tg-token');
    const status = await page.locator('#tg-status').innerText();
    assert.strictEqual(chatId, '999888777');
    assert.strictEqual(tokenDepois, '', 'o token não deve continuar no campo depois de usado');
    assert.ok(status.includes('encontrado'), 'deveria mostrar uma mensagem de sucesso');
    await page.close();
  });

  await test('descobrirChatIdTelegram avisa quando não há nenhuma mensagem ainda', async () => {
    const page = await newPage(browser, baseUrl);
    await page.route('https://api.telegram.org/**/getUpdates', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result: [] }) });
    });
    await page.evaluate(() => openModal('telegram'));
    await page.check('#tg-ativo');
    await page.fill('#tg-token', 'token-de-teste-123');
    await page.click('text=🔎 Buscar meu código de vínculo');
    await page.waitForTimeout(200);
    const status = await page.locator('#tg-status').innerText();
    const chatId = await page.inputValue('#tg-chatid');
    assert.ok(status.includes('Nenhuma mensagem'), 'deveria orientar o usuário a mandar uma mensagem pro bot');
    assert.strictEqual(chatId, '');
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

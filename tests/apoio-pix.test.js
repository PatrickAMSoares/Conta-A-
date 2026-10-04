#!/usr/bin/env node
/**
 * Testes do banner "Apoie o projeto" (chave Pix) — deve aparecer em pelo
 * menos 3 dias por semana, ficar visível o dia inteiro nesses dias (sem
 * botão de dispensar) e permitir copiar a chave Pix.
 */

const assert = require('assert');
const { startServer, launchBrowser, newPage, makeRunner } = require('./helpers');

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();
  const { test, report } = makeRunner();

  console.log('Banner "Apoie o projeto" (Pix) — Conta Aí\n');

  await test('_ehDiaDeApoio aparece em pelo menos 3 dos 7 dias de uma semana', async () => {
    const page = await newPage(browser, baseUrl);
    const diasQueAparece = await page.evaluate(() => {
      // Segunda-feira de uma semana fixa, usada como base pros 7 dias.
      const base = new Date(2026, 0, 5); // uma segunda-feira
      let count = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(base);
        d.setDate(base.getDate() + i);
        if (_ehDiaDeApoio(d)) count++;
      }
      return count;
    });
    assert.ok(diasQueAparece >= 3, `esperava pelo menos 3 dias, veio ${diasQueAparece}`);
    await page.close();
  });

  await test('o mesmo dia sempre dá o mesmo resultado (estável, não muda a cada chamada)', async () => {
    const page = await newPage(browser, baseUrl);
    const estavel = await page.evaluate(() => {
      const d = new Date(2026, 2, 10);
      const a = _ehDiaDeApoio(d);
      const b = _ehDiaDeApoio(d);
      const c = _ehDiaDeApoio(new Date(d));
      return a === b && b === c;
    });
    assert.strictEqual(estavel, true);
    await page.close();
  });

  await test('semanas diferentes podem sortear dias diferentes (não é sempre seg/qua/sex)', async () => {
    const page = await newPage(browser, baseUrl);
    const padroes = await page.evaluate(() => {
      const padroesDasSemanas = [];
      for (let semana = 0; semana < 8; semana++) {
        const base = new Date(2026, 0, 5 + semana * 7);
        const padrao = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(base);
          d.setDate(base.getDate() + i);
          padrao.push(_ehDiaDeApoio(d));
        }
        padroesDasSemanas.push(padrao.join(''));
      }
      return padroesDasSemanas;
    });
    const padroesUnicos = new Set(padroes);
    assert.ok(padroesUnicos.size > 1, 'esperava que o conjunto de dias variasse entre semanas diferentes');
    await page.close();
  });

  await test('atualizarBannerApoio mostra o banner nos dias sorteados e esconde nos outros', async () => {
    const page = await newPage(browser, baseUrl);
    const resultado = await page.evaluate(() => {
      let diaComBanner = null, diaSemBanner = null;
      for (let i = 0; i < 7; i++) {
        const d = new Date(2026, 0, 5 + i);
        if (_ehDiaDeApoio(d)) diaComBanner = diaComBanner || d;
        else diaSemBanner = diaSemBanner || d;
      }
      const r = {};
      if (diaComBanner) {
        atualizarBannerApoio(diaComBanner);
        r.comBanner = document.getElementById('apoio-banner').classList.contains('show');
      }
      if (diaSemBanner) {
        atualizarBannerApoio(diaSemBanner);
        r.semBanner = document.getElementById('apoio-banner').classList.contains('show');
      }
      return r;
    });
    assert.strictEqual(resultado.comBanner, true);
    assert.strictEqual(resultado.semBanner, false);
    await page.close();
  });

  await test('o banner não tem nenhum botão de dispensar/fechar', async () => {
    const page = await newPage(browser, baseUrl);
    await page.evaluate(() => { document.getElementById('apoio-banner').classList.add('show'); });
    const botoesFechar = await page.locator('#apoio-banner button:not([onclick="copiarChavePix()"])').count();
    const temBotaoCopiar = await page.locator('#apoio-banner button[onclick="copiarChavePix()"]').count();
    assert.strictEqual(botoesFechar, 0, 'não deveria ter nenhum botão além do de copiar a chave');
    assert.strictEqual(temBotaoCopiar, 1);
    await page.close();
  });

  await test('o banner mostra a chave Pix correta', async () => {
    const page = await newPage(browser, baseUrl);
    const texto = await page.locator('#apoio-banner').innerText();
    assert.ok(texto.includes('createartapps@gmail.com'), `esperava ver a chave Pix no banner, veio "${texto}"`);
    await page.close();
  });

  await test('copiarChavePix copia a chave certa pra área de transferência', async () => {
    const page = await newPage(browser, baseUrl);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => copiarChavePix());
    await page.waitForTimeout(100);
    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    assert.strictEqual(copiado, 'createartapps@gmail.com');
    const status = await page.locator('#toast').innerText();
    assert.ok(status.includes('copiada'), 'deveria confirmar que a chave foi copiada');
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

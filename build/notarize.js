/**
 * Notarização do app depois da assinatura (hook afterSign do electron-builder).
 *
 * Só roda quando as credenciais da Apple estão no ambiente — sem elas, avisa e
 * segue em frente, para o build local continuar funcionando enquanto a conta
 * Apple Developer não está ativa. Nunca finge que notarizou.
 *
 * Variáveis necessárias (ver docs/macos-signing-and-notarization.md):
 *   APPLE_ID                    e-mail da conta Apple Developer
 *   APPLE_APP_SPECIFIC_PASSWORD senha de app gerada em appleid.apple.com
 *   APPLE_TEAM_ID               Team ID (Membership no developer.apple.com)
 */
const path = require('path');

module.exports = async function notarize(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log(
      '[vozza] Notarização PULADA — defina APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD e APPLE_TEAM_ID. ' +
        'O app deste build vai disparar o aviso do Gatekeeper.',
    );
    return;
  }

  // Carregado sob demanda: o pacote só é exigido quando dá pra notarizar de verdade.
  const { notarize: doNotarize } = require('@electron/notarize');
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  console.log(`[vozza] Notarizando ${appPath} (pode levar alguns minutos)…`);
  await doNotarize({
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log('[vozza] Notarização concluída — o stapling é feito pelo electron-builder.');
};

# VozzAI — assinatura e notarização do macOS

Estado em 26/07/2026: **pipeline pronta, aguardando a Apple**. A conta Apple
Developer (individual, US$ 99/ano) foi comprada em 26/07; a ativação leva até
2 dias úteis. Até lá, todo build sai **não assinado** e o Gatekeeper mostra o
aviso de "desenvolvedor não identificado" — e a landing continua dizendo isso
honestamente na seção de download.

## O que já está pronto no repositório

- `build/entitlements.mac.plist` — hardened runtime com JIT (Electron/V8) e
  microfone.
- `package.json → build.mac` — `hardenedRuntime: true`, entitlements aplicados
  ao app e aos helpers (`entitlementsInherit`).
- `build/notarize.js` — hook `afterSign`: notariza quando as credenciais estão
  no ambiente; sem elas, **pula com aviso** e o build local segue funcionando.
- Sem certificado no Keychain, o electron-builder pula a assinatura sozinho
  (verificado: `npm run dist` gera o .dmg normalmente, com aviso).

## Passo a passo quando a conta ativar

### 1. Criar o certificado "Developer ID Application"

1. Entre em [developer.apple.com/account](https://developer.apple.com/account)
   → Certificates, Identifiers & Profiles → Certificates → **+**.
2. Escolha **Developer ID Application** (é o tipo para distribuir FORA da App
   Store).
3. Ele pede um CSR: abra o **Acesso às Chaves** (Keychain Access) no Mac →
   menu Acesso às Chaves → Assistente de Certificado → Solicitar Certificado
   de uma Autoridade… → preencha o e-mail da conta, marque "Salva em disco".
4. Suba o `.certSigningRequest`, baixe o `.cer` gerado e dê dois cliques nele
   — ele entra no Keychain junto com a chave privada.
5. Confira: `security find-identity -v -p codesigning` deve listar
   `Developer ID Application: <nome> (<TEAM_ID>)`.

Com o certificado no Keychain, o electron-builder **acha e usa sozinho** — não
precisa configurar nada no projeto.

### 2. Credenciais de notarização

| Variável | Onde conseguir |
|---|---|
| `APPLE_ID` | O e-mail da conta Apple Developer |
| `APPLE_APP_SPECIFIC_PASSWORD` | [appleid.apple.com](https://account.apple.com) → Sign-In and Security → App-Specific Passwords (NUNCA a senha real da conta) |
| `APPLE_TEAM_ID` | developer.apple.com/account → Membership details → Team ID (10 caracteres) |

### 3. Gerar o build assinado e notarizado

```bash
APPLE_ID="seu@email.com" \
APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
APPLE_TEAM_ID="XXXXXXXXXX" \
npm run dist
```

A notarização leva alguns minutos (a Apple analisa o binário nos servidores
dela). O stapling (grudar o carimbo no .dmg para funcionar offline) é feito
pelo electron-builder na sequência.

### 4. Validar de verdade (antes de publicar qualquer selo)

```bash
# Assinatura íntegra em todo o bundle
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/VozzAI.app"

# O Gatekeeper aceita? (é ESTE o teste que importa)
spctl --assess --type execute -vv "release/mac-arm64/VozzAI.app"
# esperado: "accepted · source=Notarized Developer ID"

# Carimbo de notarização preso ao dmg
xcrun stapler validate "release/VozzAI-0.1.0-arm64.dmg"
```

Só depois desses três comandos passarem: substituir o
`web/downloads/VozzAI.dmg`, atualizar o aviso do Gatekeeper na landing
(remover a instrução de clicar com botão direito) e só então falar em
"verificado pela Apple".

## Segurança das credenciais

- Nada de credencial no repositório — só variáveis de ambiente na hora do
  build (ou secrets do CI, se um dia tiver).
- A senha específica de app pode ser revogada a qualquer momento em
  appleid.apple.com sem trocar a senha da conta.
- O certificado + chave privada moram no Keychain do Mac do João; para CI,
  exportar como `.p12` e usar `CSC_LINK`/`CSC_KEY_PASSWORD` (documentação do
  electron-builder), nunca commitado.

## O que depende só da ativação da Apple

1. Criar o certificado (passo 1) — bloqueado até a conta ativar.
2. Gerar a senha específica de app (passo 2).
3. Rodar o build assinado + validações (passos 3-4).
4. Trocar o .dmg do site e ajustar o texto da landing.

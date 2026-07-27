import { app } from './app';
import { initSchema } from './db';
import { reconcileAllSubscriptions } from './mercadopago';

process.on('unhandledRejection', (err) => {
  console.error('[vozza] promise rejeitada sem tratamento:', err);
});

const port = Number(process.env.PORT || 3000);

// Rede de segurança para webhooks perdidos do Mercado Pago — roda só no
// processo de produção (não em app.ts, que os testes importam sem querer
// isso rodando em background). Uma vez logo na subida (cobre o tempo em que
// o servidor ficou fora do ar) e depois a cada hora.
function scheduleSubscriptionReconciliation(): void {
  const run = () => {
    reconcileAllSubscriptions()
      .then(({ checked, failed }) => {
        if (checked > 0) console.log(`[vozza] reconciliação MP: ${checked} verificadas, ${failed} falharam`);
      })
      .catch((err) => console.error('[vozza] reconciliação MP falhou:', err));
  };
  run();
  setInterval(run, 60 * 60 * 1000);
}

initSchema()
  .then(() => {
    app.listen(port, () => console.log(`[vozza] servidor ouvindo na porta ${port}`));
    scheduleSubscriptionReconciliation();
  })
  .catch((err) => {
    console.error('[vozza] falha ao preparar o banco de dados:', err);
    process.exit(1);
  });

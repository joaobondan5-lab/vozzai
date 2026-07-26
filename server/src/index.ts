import { app } from './app';
import { initSchema } from './db';

process.on('unhandledRejection', (err) => {
  console.error('[vozza] promise rejeitada sem tratamento:', err);
});

const port = Number(process.env.PORT || 3000);

initSchema()
  .then(() => {
    app.listen(port, () => console.log(`[vozza] servidor ouvindo na porta ${port}`));
  })
  .catch((err) => {
    console.error('[vozza] falha ao preparar o banco de dados:', err);
    process.exit(1);
  });

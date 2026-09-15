const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const cron = require('node-cron');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const scheduler = () => {
  // Chaque profil choisit sa propre heure de rappel (Profil > Rappel du
  // soir) : on vérifie donc chaque minute si l'heure locale de l'un d'eux
  // correspond ("/api/send-reminders" ne fait rien tant que ce n'est pas
  // le cas, voir app/api/send-reminders/route.ts).
  cron.schedule(
    '* * * * *',
    async () => {
      const targetUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/send-reminders`;

      try {
        const response = await fetch(targetUrl, { method: 'GET' });
        const text = await response.text();
        if (response.status !== 200 || JSON.parse(text || '{}').sent > 0) {
          console.log(`[scheduler] ${new Date().toISOString()} — status ${response.status} — ${text.slice(0, 500)}`);
        }
      } catch (error) {
        console.error('[scheduler] Failed to call reminders API:', error);
      }
    },
    { scheduled: true }
  );

  console.log('[scheduler] Reminder check registered (every minute — each profile keeps its own time/timezone).');
};

app.prepare().then(() => {
  scheduler();

  createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling request:', err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  }).listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});

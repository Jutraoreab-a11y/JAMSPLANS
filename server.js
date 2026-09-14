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
  cron.schedule(
    '0 22 * * *',
    async () => {
      const targetUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/send-reminders`;
      console.log(`[scheduler] Triggering reminders at 22:00: ${new Date().toISOString()}`);

      try {
        const response = await fetch(targetUrl, { method: 'GET' });
        const text = await response.text();

        console.log(`[scheduler] Response status: ${response.status}`);
        console.log(`[scheduler] Response body: ${text.slice(0, 500)}`);
      } catch (error) {
        console.error('[scheduler] Failed to call reminders API:', error);
      }
    },
    {
      timezone: 'Europe/Paris',
      scheduled: true,
    }
  );

  console.log('[scheduler] Daily 22:00 reminder task registered (Europe/Paris timezone).');
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

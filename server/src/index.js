import { config } from "./config.js";
import { migrate, pool, q } from "./db.js";
import { createApp } from "./app.js";

await migrate();

// Hourly housekeeping: expired sessions and invites.
const cleanup = () => Promise.all([
  q("DELETE FROM sessions WHERE expires_at < now()"),
  q("DELETE FROM invites WHERE expires_at < now() - interval '30 days'"),
]).catch((err) => console.error("cleanup failed", err));
cleanup();
const timer = setInterval(cleanup, 60 * 60 * 1000);

const server = createApp().listen(config.port, () => {
  console.log(`Move30 listening on ${config.appUrl} (port ${config.port})`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    clearInterval(timer);
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}

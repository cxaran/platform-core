import { createContainer } from "./bootstrap/container.js";
import { buildApp } from "./transport/http/app.js";

const container = createContainer();
const app = await buildApp(container);

try {
  await app.listen({ host: container.settings.host, port: container.settings.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

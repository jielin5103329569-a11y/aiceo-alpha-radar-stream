import app from "./app";
import { logger } from "./lib/logger";
import { databentoLive } from "./lib/databentoLive";
import { marketUniverse } from "./lib/marketUniverse";
import { alertService } from "./lib/alertService";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  marketUniverse.start();
  const liveStatus = databentoLive.start();
  logger.info(
    {
      symbols: liveStatus.symbolRadars?.map((symbol) => symbol.symbol) ?? [liveStatus.symbol],
      configured: liveStatus.configured,
    },
    "Armed protected Databento live bridges",
  );
  alertService.start();
});

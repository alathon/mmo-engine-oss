import { listen } from "@colyseus/tools";

// Import Colyseus config
import app from "./app-config";
import { matchMaker } from "colyseus";
import { DefaultZoneLoader } from "./world/zones/zone-loader";

const zoneLoader = new DefaultZoneLoader();

const bootServer = async () => {
  const zoneData = await zoneLoader.load("startingPlains");
  await matchMaker.createRoom("zone", { zoneData, zoneId: zoneData.zoneId });
  console.log("startingPlains created");

  const server = await listen(app);
  if (process.env.SIMULATE_LATENCY) {
    const latency = Number.parseInt(process.env.SIMULATE_LATENCY);
    if (!Number.isNaN(latency) && latency >= 0) {
      server.simulateLatency(latency);
    }
  }
};

bootServer();

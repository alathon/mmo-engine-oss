import { listen } from "@colyseus/tools";

// Import Colyseus config
import app from "./appConfig";
import { matchMaker } from "colyseus";
import { DefaultZoneLoader } from "./world/zones/zoneLoader";

const zoneLoader = new DefaultZoneLoader();

const bootServer = async () => {
  const zoneData = await zoneLoader.load("startingPlains");
  await matchMaker.createRoom("zone", { zoneData, zoneId: zoneData.zoneId });
  console.log("StartingPlains created");

  const server = await listen(app);
  if (process.env.SIMULATE_LATENCY) {
    const latency = parseInt(process.env.SIMULATE_LATENCY);
    if (!isNaN(latency) && latency >= 0) {
      server.simulateLatency(latency);
    }
  }
};

bootServer();

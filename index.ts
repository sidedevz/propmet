import DLMM, { StrategyType } from "@meteora-ag/dlmm";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Strategy, type StrategyConfig } from "./strategy";
import "dotenv/config";
import { Solana } from "./solana";
import { HermesWS } from "./hermes_ws";

if (!process.env.READ_RPC_URL) {
  throw new Error("READ_RPC_URL environment variable is not set.");
}

if (!process.env.WRITE_RPC_URL) {
  throw new Error("WRITE_RPC_URL environment variable is not set.");
}

if (!process.env.SECRET_KEY) {
  throw new Error("SECRET_KEY environment variable is not set.");
}
if (!process.env.POS_SECRET_KEY_1) {
  throw new Error("POS_SECRET_KEY_1 environment variable is not set.");
}
if (!process.env.POS_SECRET_KEY_2) {
  throw new Error("POS_SECRET_KEY_2 environment variable is not set.");
}
if (!process.env.POS_SECRET_KEY_3) {
  throw new Error("POS_SECRET_KEY_3 environment variable is not set.");
}

if (!process.env.POOL) {
  throw new Error("POOL environment variable is not set.");
}

const posKeypair1 = Keypair.fromSecretKey(
  Uint8Array.from(process.env.POS_SECRET_KEY_1.split(",").map((v) => Number(v.trim()))),
);
const posKeypair2 = Keypair.fromSecretKey(
  Uint8Array.from(process.env.POS_SECRET_KEY_2.split(",").map((v) => Number(v.trim()))),
);
const posKeypair3 = Keypair.fromSecretKey(
  Uint8Array.from(process.env.POS_SECRET_KEY_3.split(",").map((v) => Number(v.trim()))),
);

const solana = new Solana({
  read: process.env.READ_RPC_URL!,
  write: process.env.WRITE_RPC_URL!,
  ws: process.env.WS_RPC_URL!,
});

// You can get your desired pool address from the API https://dlmm-api.meteora.ag/pair/all

const FLUID_USDC_POOL_ADDRESS = new PublicKey("6UhWp9UxnpacCFxQA61ZFwTjpj29XizFEMw5fgoty6mT");
const HYPE_USDC_POOL_ADDRESS = new PublicKey("DDzyqUudBdtZMkpbELV6meME8M9M2cMgUqc5pAJxKzaG");
const ZENZEC_USDC_POOL_ADDRESS = new PublicKey("3FYdSeUvYMCd7D2yXCjj3rBYcywU75oPQ3X2u61goqMW");

const FLUID_USDC_PRICE_FEEDS = [
  // FLUID-USD
  "0x47d462d8bac4c29b6ae1792029b9b92c8adea12ed22155bfc22f481287f1e349",
];
const HYPE_USDC_PRICE_FEEDS = [
  // HYPE-USD
  "0x4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b",
];
const ZEC_USDC_PRICE_FEEDS = [
  // ZEC-USD
  "0xbe9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24",
];

const POOL_CONFIGS: Record<
  string,
  { priceFeeds: string[]; poolAddress: PublicKey; userKeypair: Keypair } & StrategyConfig
> = {
  "fluid/usdc": {
    userKeypair: posKeypair1, // IMPORTANT
    priceFeeds: FLUID_USDC_PRICE_FEEDS,
    poolAddress: FLUID_USDC_POOL_ADDRESS,
    priceRangeDelta: 300,
    inventorySkewThreshold: 3000,
    rebalanceThreshold: 7500,
    maxRebalanceSlippage: 500,
    type: StrategyType.BidAsk,
  },
  "hype/usdc": {
    userKeypair: posKeypair2, // IMPORTANT
    priceFeeds: HYPE_USDC_PRICE_FEEDS,
    poolAddress: HYPE_USDC_POOL_ADDRESS,
    priceRangeDelta: 300,
    inventorySkewThreshold: 3000,
    rebalanceThreshold: 7500,
    maxRebalanceSlippage: 500,
    type: StrategyType.BidAsk,
  },
  "zenzec/usdc": {
    userKeypair: posKeypair3, // IMPORTANT
    priceFeeds: ZEC_USDC_PRICE_FEEDS,
    poolAddress: ZENZEC_USDC_POOL_ADDRESS,
    priceRangeDelta: 300,
    inventorySkewThreshold: 3000,
    rebalanceThreshold: 7500,
    maxRebalanceSlippage: 500,
    type: StrategyType.BidAsk,
  },
};

const selectedPools = process.env.POOL!.split(",");
if (selectedPools.length === 0) {
  console.error("No pools selected");
  process.exit(1);
}

const selectedPoolConfigs = selectedPools
  .map((pool) => POOL_CONFIGS[pool])
  .filter((pool) => pool != null);
if (selectedPoolConfigs.length !== selectedPools.length) {
  console.error("Missing pool configs for some of the selected pools");
  process.exit(1);
}

const strategies = await Promise.all(
  selectedPoolConfigs.map(async (poolConfig) => {
    const dlmm = await DLMM.create(solana.connection, poolConfig.poolAddress);
    return {
      strategy: new Strategy(solana, dlmm, poolConfig.userKeypair, poolConfig),
      priceFeeds: poolConfig.priceFeeds,
    };
  }),
);

const hermes = new HermesWS("https://hermes.pyth.network", strategies);

await hermes.connect();

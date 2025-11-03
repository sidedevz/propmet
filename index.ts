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

if (!process.env.POOL) {
  throw new Error("POOL environment variable is not set.");
}

const secretKey = Uint8Array.from(process.env.SECRET_KEY.split(",").map((v) => Number(v.trim())));

const userKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));

const solana = new Solana({
  read: process.env.READ_RPC_URL!,
  write: process.env.WRITE_RPC_URL!,
  ws: process.env.WS_RPC_URL!,
});

// You can get your desired pool address from the API https://dlmm-api.meteora.ag/pair/all
const JUP_SOL_POOL_ADDRESS = new PublicKey("FpjYwNjCStVE2Rvk9yVZsV46YwgNTFjp7ktJUDcZdyyk");
const JUP_USDC_POOL_ADDRESS = new PublicKey("BhQEFZCRnWKQ21LEt4DUby7fKynfmLVJcNjfHNqjEF61");
const MET_USDC_POOL_ADDRESS = new PublicKey("5hbf9JP8k5zdrZp9pokPypFQoBse5mGCmW6nqodurGcd");
const FLUID_SOL_POOL_ADDRESS = new PublicKey("4mPKhtkMtRXyQcgSjzog14nnonHowvLhB4fyVkMfSECA");

const JUP_SOL_PRICE_FEEDS = [
  // JUP-USD
  "0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996",
  // SOL-USD
  "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
];
const JUP_USDC_PRICE_FEEDS = [
  // JUP-USD
  "0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996",
  // USDC-USD
  "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
];
const FLUID_SOL_PRICE_FEEDS = [
  // FLUID-USD
  "0x47d462d8bac4c29b6ae1792029b9b92c8adea12ed22155bfc22f481287f1e349",
  // SOL-USD
  "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
];

const MET_USDC_PRICE_FEEDS = [
  // MET-USD
  "0x0292e0f405bcd4a496d34e48307f6787349ad2bcd8505c3d3a9f77d81a67a682",
];

const POOL_CONFIGS: Record<
  string,
  { priceFeeds: string[]; poolAddress: PublicKey } & StrategyConfig
> = {
  "jup/sol": {
    priceFeeds: JUP_SOL_PRICE_FEEDS,
    poolAddress: JUP_SOL_POOL_ADDRESS,
    priceRangeDelta: 1000,
    inventorySkewThreshold: 1500,
    rebalanceThreshold: 8000,
    maxRebalanceSlippage: 500,
    type: StrategyType.BidAsk,
  },
  "jup/usdc": {
    priceFeeds: JUP_USDC_PRICE_FEEDS,
    poolAddress: JUP_USDC_POOL_ADDRESS,
    priceRangeDelta: 1000,
    inventorySkewThreshold: 1500,
    rebalanceThreshold: 8000,
    maxRebalanceSlippage: 500,
    type: StrategyType.BidAsk,
  },
  "met/usdc": {
    priceFeeds: MET_USDC_PRICE_FEEDS,
    poolAddress: MET_USDC_POOL_ADDRESS,
    priceRangeDelta: 500,
    inventorySkewThreshold: 1500,
    rebalanceThreshold: 8000,
    maxRebalanceSlippage: 500,
    type: StrategyType.BidAsk,
  },
  "fluid/sol": {
    priceFeeds: FLUID_SOL_PRICE_FEEDS,
    poolAddress: FLUID_SOL_POOL_ADDRESS,
    priceRangeDelta: 3000,
    inventorySkewThreshold: 1500,
    rebalanceThreshold: 3000,
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
      strategy: new Strategy(solana, dlmm, userKeypair, poolConfig),
      priceFeeds: poolConfig.priceFeeds,
    };
  }),
);

const hermes = new HermesWS("https://hermes.pyth.network", strategies);

await hermes.connect();

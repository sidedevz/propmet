import DLMM, {
  type StrategyType,
  type LbPosition,
  DEFAULT_BIN_PER_POSITION,
} from "@meteora-ag/dlmm";
import { Keypair, type Transaction, type PublicKey } from "@solana/web3.js";
import { getTokenBalance, type Solana } from "./solana";
import { BN } from "bn.js";
import { WSOL_MINT } from "./const";
import { executeJupUltraOrder, getJupUltraOrder } from "./jup-utils";
import { retry } from "./retry";
import type { Logger } from "./logger";
import type { Tinybird } from "./tinybird";

export type StrategyConfig = {
  priceRangeDelta: number; // in basis points
  inventorySkewThreshold: number; // in basis points
  type: StrategyType;
  rebalanceThreshold: number; // in basis points
  maxRebalanceSlippage: number; // in basis points
};

export class Strategy {
  readonly baseToken: {
    mint: PublicKey;
    decimals: number;
  };
  readonly quoteToken: {
    mint: PublicKey;
    decimals: number;
  };

  private position: LbPosition | null = null;
  private positionFetched = false;

  private isBusy = false;

  constructor(
    readonly pair: string,
    private readonly solana: Solana,
    private readonly dlmm: DLMM,
    private readonly userKeypair: Keypair,
    private readonly config: StrategyConfig,
    private readonly logger: Logger,
    private readonly tinybird: Tinybird,
  ) {
    this.baseToken = {
      mint: dlmm.tokenX.mint.address,
      decimals: dlmm.tokenX.mint.decimals,
    };
    this.quoteToken = {
      mint: dlmm.tokenY.mint.address,
      decimals: dlmm.tokenY.mint.decimals,
    };
  }

  async run(marketPrice: number) {
    // Skip if already processing
    if (this.isBusy) {
      return;
    }

    // Ensure we have a position (fetch it if needed, but don't create yet)
    if (!this.positionFetched) {
      await this.fetchExistingPosition();
    }

    // If no position exists, create one
    if (this.position == null) {
      await this.safeExecute(async () => {
        const createPositionResult = await this.createPosition(marketPrice);
        if (createPositionResult == null || createPositionResult.position == null) {
          this.logger.error("Failed to create position", null);
          return;
        }
        this.position = createPositionResult.position;
        await this.tinybird.logEvent({
          type: "positions",
          event: {
            timestamp: Date.now(),
            pair: this.pair.toString(),
            positionAddress: this.position?.publicKey.toString() ?? "",
            upperBinId: this.position?.positionData.upperBinId ?? 0,
            lowerBinId: this.position?.positionData.lowerBinId ?? 0,
            quoteRawAmount: BigInt(this.position?.positionData.totalYAmount ?? 0),
            baseRawAmount: BigInt(this.position?.positionData.totalXAmount ?? 0),
            transactionId: createPositionResult.transactionId,
            oraclePrice: marketPrice,
          },
        });
      });
      return;
    }

    // Check if market price bin id has crossed rebalance bin threshold
    const marketPriceBinId = this.dlmm.getBinIdFromPrice(
      Number(
        DLMM.getPricePerLamport(this.baseToken.decimals, this.quoteToken.decimals, marketPrice),
      ),
      false,
    );

    const halfRange = Math.floor(
      (this.position.positionData.upperBinId - this.position.positionData.lowerBinId) / 2,
    );

    // calculate the bin ids for the thresholds
    const positionMidBin = this.position.positionData.lowerBinId + halfRange;

    const numBinsThreshold = Math.floor(halfRange * (this.config.rebalanceThreshold / 10000));

    const lowerThresholdBin = positionMidBin - numBinsThreshold;
    const upperThresholdBin = positionMidBin + numBinsThreshold;

    if (marketPriceBinId < lowerThresholdBin || marketPriceBinId > upperThresholdBin) {
      await this.safeExecute(async () => {
        await this.rebalancePosition(marketPrice);
      });
    }
  }

  private async fetchExistingPosition(): Promise<void> {
    if (this.positionFetched) {
      return;
    }

    await this.safeExecute(async () => {
      const existingPositions = await this.dlmm.getPositionsByUserAndLbPair(
        this.userKeypair.publicKey,
      );

      if (existingPositions.userPositions.length > 0) {
        this.position = existingPositions.userPositions[0]!;
      }

      this.positionFetched = true;
    });
  }

  private async rebalancePosition(marketPrice: number): Promise<void> {
    if (!this.position) {
      console.error("Cannot rebalance: no position exists");
      return;
    }

    let removeLiquidityTxs: Transaction[] = [];

    try {
      removeLiquidityTxs = await this.dlmm.removeLiquidity({
        user: this.userKeypair.publicKey,
        position: this.position.publicKey,
        fromBinId: this.position.positionData.lowerBinId,
        toBinId: this.position.positionData.upperBinId,
        bps: new BN(10000),
        shouldClaimAndClose: true,
        skipUnwrapSOL: false,
      });
    } catch (e: any) {
      this.logger.error("Failure creating removeLiquidity Ixs", e);
    }

    const currentPosition =
      removeLiquidityTxs.length > 0 ? await this.dlmm.getPosition(this.position.publicKey) : null;
    const feesClaimed =
      currentPosition != null
        ? BigInt(
            currentPosition.positionData.feeXExcludeTransferFee
              .add(currentPosition.positionData.feeYExcludeTransferFee)
              .toString(),
          )
        : BigInt(0);

    const txs: string[] = [];
    for (const tx of removeLiquidityTxs) {
      tx.partialSign(this.userKeypair);
      const sig = await this.solana.sendTransaction(tx.serialize().toString("base64"));
      txs.push(sig);
    }

    const confirmedTxs = await this.solana.confirmTransactions(txs);

    const maxLandedSlot = confirmedTxs ? Math.max(...confirmedTxs.map((tx) => tx.slot)) : null;
    if (maxLandedSlot == null || maxLandedSlot === 0) {
      throw new Error("Failed to confirm transactions");
    }

    // Reset position after remove liquidity tx validated
    this.position = null;

    try {
      const [createPositionResult] = await Promise.all([
        this.createPosition(marketPrice, maxLandedSlot),
        this.tinybird.logEvent({
          type: "withdrawals",
          event: {
            timestamp: Date.now(),
            pair: this.pair.toString(),
            positionAddress: currentPosition?.publicKey.toString() ?? "",
            feesClaimed,
            quoteRawAmount: BigInt(currentPosition?.positionData.totalYAmount ?? 0),
            baseRawAmount: BigInt(currentPosition?.positionData.totalXAmount ?? 0),
            transactionIds: txs,
          },
        }),
      ]);

      if (createPositionResult == null || createPositionResult.position == null) {
        throw new Error("Failed to create new position after closing old position");
      }

      this.position = createPositionResult.position;
      await this.tinybird.logEvent({
        type: "positions",
        event: {
          timestamp: Date.now(),
          pair: this.pair.toString(),
          positionAddress: this.position?.publicKey.toString() ?? "",
          upperBinId: this.position?.positionData.upperBinId ?? 0,
          lowerBinId: this.position?.positionData.lowerBinId ?? 0,
          quoteRawAmount: BigInt(this.position?.positionData.totalYAmount ?? 0),
          baseRawAmount: BigInt(this.position?.positionData.totalXAmount ?? 0),
          transactionId: createPositionResult.transactionId,
          oraclePrice: marketPrice,
        },
      });
    } catch (error: any) {
      // Position is already null, but we've closed the old one
      this.logger.error("Failed to create position after rebalance", error);
      throw new Error(`Failed to create position after rebalance: ${error}`);
    }
  }

  private async createPosition(
    marketPrice: number,
    minContextSlot?: number,
  ): Promise<{ position: LbPosition | null; transactionId: string } | null> {
    const inventory = await this.tryRebalanceInventory({
      marketPrice,
      minContextSlot,
    });

    const { baseBalance, quoteBalance } = inventory;

    const minBinPrice = marketPrice * (1 - this.config.priceRangeDelta / 10000);
    const maxBinPrice = marketPrice * (1 + this.config.priceRangeDelta / 10000);

    const minBinId = this.dlmm.getBinIdFromPrice(
      Number(
        DLMM.getPricePerLamport(this.baseToken.decimals, this.quoteToken.decimals, minBinPrice),
      ),
      false,
    );
    const maxBinId = this.dlmm.getBinIdFromPrice(
      Number(
        DLMM.getPricePerLamport(this.baseToken.decimals, this.quoteToken.decimals, maxBinPrice),
      ),
      false,
    );

    // If priceRangeDelta is large, we would end up opening too many bins.
    // I don't see us having positions with more than 70 bins. If we do in the future, we need to update this.
    // Currently getting some realloc erro when trying to create position with ~100 bins
    if (new BN(maxBinId - minBinId + 1) > DEFAULT_BIN_PER_POSITION) {
      this.logger.error(
        `Max bins per position exceeded: ${maxBinId - minBinId + 1} > ${DEFAULT_BIN_PER_POSITION}`,
        null,
      );
      return null;
    }

    const positionKeypair = Keypair.generate();

    await this.dlmm.refetchStates();
    //For the record, if >26 bins are created for the bin spread we would have multiple txs
    const createPositionTx = await this.dlmm.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      strategy: {
        minBinId,
        maxBinId,
        strategyType: this.config.type,
        singleSidedX: false,
      },
      totalXAmount: new BN(baseBalance),
      totalYAmount: new BN(quoteBalance),
      user: this.userKeypair.publicKey,
      slippage: 2, // Liquiditidy slippage when adding liquidity to
    });

    createPositionTx.partialSign(this.userKeypair, positionKeypair);
    const createBalancePositionTxHash = await this.solana.sendTransaction(
      createPositionTx.serialize().toString("base64"),
    );
    await this.solana.confirmTransactions([createBalancePositionTxHash]);

    const newPosition = await retry(
      async () => {
        const positions = await this.dlmm.getPositionsByUserAndLbPair(this.userKeypair.publicKey);
        if (positions.userPositions.length === 0) {
          throw new Error("Position not found");
        }

        const latestPosition = positions.userPositions.find((position) =>
          position.publicKey.equals(positionKeypair.publicKey),
        );

        if (latestPosition == null) {
          throw new Error("Position not found");
        }

        return latestPosition;
      },
      {
        initialDelay: 500,
        maxRetries: 10,
        maxDelay: 5000,
      },
    );

    return { position: newPosition, transactionId: createBalancePositionTxHash };
  }

  // Price is in terms of quote/base
  private async getInventory(price: number, minContextSlot?: number) {
    const [baseBalance, quoteBalance] = await Promise.all([
      getTokenBalance(
        this.userKeypair.publicKey,
        this.baseToken.mint,
        this.solana.connection,
        minContextSlot,
      ),
      getTokenBalance(
        this.userKeypair.publicKey,
        this.quoteToken.mint,
        this.solana.connection,
        minContextSlot,
      ),
    ]);

    // Substract 0.05 of rent
    const quoteBalanceNoRent = this.quoteToken.mint.equals(WSOL_MINT)
      ? quoteBalance - 50000000
      : quoteBalance;

    const baseValue = (baseBalance / 10 ** this.baseToken.decimals) * price; // Value of base tokens in terms of quote token
    const quoteValue = quoteBalanceNoRent / 10 ** this.quoteToken.decimals;

    return {
      baseBalance,
      quoteBalance: quoteBalanceNoRent,
      baseValue,
      quoteValue,
    };
  }

  async tryRebalanceInventory(args: {
    marketPrice: number; // in terms of quote per base (quote/base)
    minContextSlot?: number;
  }) {
    const inventory = await this.getInventory(args.marketPrice, args.minContextSlot);

    const { marketPrice } = args;
    const {
      baseValue,
      quoteValue,
      baseBalance: initialBaseBalance,
      quoteBalance: initialQuoteBalance,
    } = inventory;

    // Check ratio for inventory assets
    const difference = Math.abs(1 - baseValue / quoteValue);

    if (difference > this.config.inventorySkewThreshold / 10000) {
      const { inputMint, outputMint, inputDecimals } =
        baseValue > quoteValue
          ? {
              inputMint: this.baseToken.mint,
              inputDecimals: this.baseToken.decimals,
              outputMint: this.quoteToken.mint,
            }
          : {
              inputMint: this.quoteToken.mint,
              inputDecimals: this.quoteToken.decimals,
              outputMint: this.baseToken.mint,
            };

      const swapValue = Math.abs(baseValue - quoteValue) / 2; // this is in terms of quote token

      /**
       * If inputMint is base, we need to convert the swapValue to the number of inputMint tokens
       * `swapValue` here is in terms of quote token, and marketPrice is in terms of quote/base
       * Thus, inputAmount = swapValue(quote) / marketPrice(quote/base) = base
       *
       * Whereas, if inputMint is quote, inputAmount is simply swapValue as it is already in terms of quote token
       */
      const inputAmount = inputMint === this.baseToken.mint ? swapValue / marketPrice : swapValue; // this is in terms of inputMint token

      const jupUltraOrder = await retry(
        async () => {
          return await getJupUltraOrder(
            inputMint,
            outputMint,
            inputAmount * 10 ** inputDecimals, // converting to raw token amount
            this.userKeypair.publicKey,
            this.config.maxRebalanceSlippage,
          );
        },
        {
          maxRetries: 30,
          initialDelay: 1000,
          maxDelay: 5 * 60 * 1000, // 5 minutes
        },
      );

      const executeResult = await executeJupUltraOrder(
        jupUltraOrder.transaction,
        jupUltraOrder.requestId,
        this.userKeypair,
      );

      const updatedInventory = await this.getInventory(marketPrice, Number(executeResult.slot));

      await this.tinybird.logEvent({
        type: "swaps",
        event: {
          timestamp: Date.now(),
          pair: this.pair.toString(),
          initialQuoteRawAmount: BigInt(initialQuoteBalance),
          initialBaseRawAmount: BigInt(initialBaseBalance),
          finalQuoteRawAmount: BigInt(updatedInventory.quoteBalance),
          finalBaseRawAmount: BigInt(updatedInventory.baseBalance),
          transactionId: executeResult.signature,
        },
      });
      return updatedInventory;
    }

    return inventory;
  }

  private async safeExecute<T>(callback: () => T | Promise<T>): Promise<T | null> {
    if (this.isBusy) {
      return null;
    }

    this.isBusy = true;

    try {
      const result = await callback();
      return result;
    } catch (error: any) {
      console.error("Error during strategy execution:", error);
      this.logger.error("Error during strategy execution:", error);

      throw error;
    } finally {
      this.isBusy = false;
    }
  }
}

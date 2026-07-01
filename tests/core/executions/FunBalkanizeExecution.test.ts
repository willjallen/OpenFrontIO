import { FunBalkanizeExecution } from "../../../src/core/execution/FunBalkanizeExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

const gameID = "balkanize_test";

function claimLandShare(game: Game, player: Player, share: number): number {
  const targetTiles = Math.ceil(game.numLandTiles() * share);
  let assigned = 0;

  game.forEachTile((tile) => {
    if (assigned >= targetTiles) {
      return;
    }
    if (!game.isLand(tile) || game.isImpassable(tile)) {
      return;
    }
    player.conquer(tile);
    assigned++;
  });

  return assigned;
}

function addFunBalkanize(
  game: Game,
  options: ConstructorParameters<typeof FunBalkanizeExecution>[1],
): void {
  game.addExecution(
    new FunBalkanizeExecution(gameID, {
      minThreshold: 0.5,
      maxThreshold: 0.5,
      scanIntervalTicks: 1,
      ...options,
    }),
  );
}

describe("FunBalkanizeExecution", () => {
  test("splits an oversized nation and revives a dead nation first", async () => {
    const game = await setup("plains");
    const target = game.addPlayer(
      new PlayerInfo("Dominant", PlayerType.Nation, null, "dominant_id"),
    );
    const revived = game.addPlayer(
      new PlayerInfo("Revived", PlayerType.Nation, null, "revived_id"),
    );
    const originalTiles = claimLandShare(game, target, 0.75);

    expect(revived.isAlive()).toBe(false);

    addFunBalkanize(game, {
      minPieces: 2,
      maxPieces: 2,
      maxCreatedPlayers: 0,
    });
    executeTicks(game, 2);

    expect(game.allPlayers()).toHaveLength(2);
    expect(target.isAlive()).toBe(true);
    expect(revived.isAlive()).toBe(true);
    expect(target.numTilesOwned() + revived.numTilesOwned()).toBe(
      originalTiles,
    );
  });

  test("caps brand-new nations when not enough dead nations exist", async () => {
    const game = await setup("plains");
    const target = game.addPlayer(
      new PlayerInfo("Dominant", PlayerType.Nation, null, "dominant_id"),
    );
    const originalTiles = claimLandShare(game, target, 0.75);

    addFunBalkanize(game, {
      minPieces: 5,
      maxPieces: 5,
      maxCreatedPlayers: 2,
    });
    executeTicks(game, 2);

    const nations = game
      .allPlayers()
      .filter((player) => player.type() === PlayerType.Nation);
    expect(nations).toHaveLength(3);
    expect(
      nations.filter((player) => player.name().startsWith("Breakaway")),
    ).toHaveLength(2);
    expect(
      nations.reduce((sum, player) => sum + player.numTilesOwned(), 0),
    ).toBe(originalTiles);
  });

  test("defaults to a thirty-three percent balkanization threshold", async () => {
    const game = await setup("plains");
    const target = game.addPlayer(
      new PlayerInfo("Dominant", PlayerType.Nation, null, "dominant_id"),
    );
    const revived = game.addPlayer(
      new PlayerInfo("Revived", PlayerType.Nation, null, "revived_id"),
    );
    const originalTiles = claimLandShare(game, target, 0.34);

    game.addExecution(
      new FunBalkanizeExecution(gameID, {
        minPieces: 2,
        maxPieces: 2,
        maxCreatedPlayers: 0,
        scanIntervalTicks: 1,
      }),
    );
    executeTicks(game, 2);

    expect(revived.isAlive()).toBe(true);
    expect(target.numTilesOwned() + revived.numTilesOwned()).toBe(
      originalTiles,
    );
  });

  test("defaults to fifty to eighty split participants", async () => {
    const game = await setup("plains");
    const target = game.addPlayer(
      new PlayerInfo("Dominant", PlayerType.Nation, null, "dominant_id"),
    );
    const originalTiles = claimLandShare(game, target, 0.75);

    for (let i = 0; i < 90; i++) {
      game.addPlayer(
        new PlayerInfo(`DeadNation${i}`, PlayerType.Nation, null, `dead_${i}`),
      );
    }

    addFunBalkanize(game, {});
    executeTicks(game, 2);

    const liveNations = game
      .allPlayers()
      .filter(
        (player) => player.type() === PlayerType.Nation && player.isAlive(),
      );
    expect(liveNations.length).toBeGreaterThanOrEqual(50);
    expect(liveNations.length).toBeLessThanOrEqual(80);
    expect(
      liveNations.reduce((sum, player) => sum + player.numTilesOwned(), 0),
    ).toBe(originalTiles);
  });

  test.each([PlayerType.Human, PlayerType.Bot])(
    "does not balkanize %s players",
    async (playerType) => {
      const game = await setup("plains");
      const target = game.addPlayer(
        new PlayerInfo("Target", playerType, null, "target_id"),
      );
      const deadNation = game.addPlayer(
        new PlayerInfo("DeadNation", PlayerType.Nation, null, "dead_id"),
      );
      const originalTiles = claimLandShare(game, target, 0.75);

      addFunBalkanize(game, {
        minPieces: 2,
        maxPieces: 2,
        maxCreatedPlayers: 2,
      });
      executeTicks(game, 2);

      expect(game.allPlayers()).toHaveLength(2);
      expect(target.numTilesOwned()).toBe(originalTiles);
      expect(deadNation.isAlive()).toBe(false);
    },
  );
});

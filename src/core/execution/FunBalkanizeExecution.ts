import {
  Execution,
  Game,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { NationExecution } from "./NationExecution";
import { PlayerExecution } from "./PlayerExecution";

export interface FunBalkanizeExecutionOptions {
  minThreshold?: number;
  maxThreshold?: number;
  minPieces?: number;
  maxPieces?: number;
  maxCreatedPlayers?: number;
  scanIntervalTicks?: number;
}

const DEFAULT_OPTIONS: Required<FunBalkanizeExecutionOptions> = {
  minThreshold: 0.4,
  maxThreshold: 0.4,
  minPieces: 20,
  maxPieces: 40,
  maxCreatedPlayers: 1000,
  scanIntervalTicks: 10,
};

export class FunBalkanizeExecution implements Execution {
  private mg!: Game;
  private readonly random: PseudoRandom;
  private readonly thresholds = new Map<string, number>();
  private readonly options: Required<FunBalkanizeExecutionOptions>;
  private createdPlayers = 0;
  private nbuf: TileRef[] = [0, 0, 0, 0];

  constructor(
    private readonly gameID: GameID,
    options: FunBalkanizeExecutionOptions = {},
  ) {
    this.random = new PseudoRandom(simpleHash(gameID) + 3);
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.mg.getWinner() !== null) {
      return;
    }
    if (ticks % Math.max(1, this.options.scanIntervalTicks) !== 0) {
      return;
    }

    const totalLand = this.mg.numLandTiles();
    if (totalLand <= 0) {
      return;
    }

    const candidate = this.mg
      .players()
      .filter((player) => player.type() === PlayerType.Nation)
      .filter(
        (player) =>
          player.numTilesOwned() / totalLand >= this.thresholdFor(player),
      )
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0];

    if (candidate === undefined) {
      return;
    }

    this.balkanize(candidate);
  }

  isActive(): boolean {
    return true;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private thresholdFor(player: Player): number {
    const existing = this.thresholds.get(player.id());
    if (existing !== undefined) {
      return existing;
    }

    const min = this.options.minThreshold;
    const max = Math.max(min, this.options.maxThreshold);
    const threshold = max === min ? min : this.random.nextFloat(min, max);
    this.thresholds.set(player.id(), threshold);
    return threshold;
  }

  private balkanize(target: Player): void {
    const targetTiles = Array.from(target.tiles());
    if (targetTiles.length < 2) {
      return;
    }

    const requestedPieces = this.random.nextInt(
      this.options.minPieces,
      this.options.maxPieces + 1,
    );
    const pieceCount = Math.min(
      Math.max(2, requestedPieces),
      targetTiles.length,
    );
    const participants = this.selectParticipants(target, pieceCount);

    if (participants.length < 2) {
      return;
    }

    const targetGold = target.gold();
    const targetTroops = target.troops();
    this.clearAttacks(participants);
    target.removeGold(targetGold);

    const assignments = this.assignTiles(targetTiles, participants);

    for (const [player, tiles] of assignments) {
      for (const tile of tiles) {
        if (player !== target) {
          player.conquer(tile);
        }
      }
    }

    this.distributeResources(
      target,
      participants,
      assignments,
      targetTiles.length,
      targetGold,
      targetTroops,
    );

    for (const player of participants) {
      this.thresholds.delete(player.id());
      if (player !== target) {
        this.addNationExecutions(player);
      }
    }
  }

  private selectParticipants(target: Player, requested: number): Player[] {
    const participants: Player[] = [target];
    const deadNations = this.random.shuffleArray(
      this.mg
        .allPlayers()
        .filter(
          (player) =>
            player !== target &&
            player.type() === PlayerType.Nation &&
            !player.isAlive(),
        ),
    );

    for (const player of deadNations) {
      if (participants.length >= requested) {
        break;
      }
      participants.push(player);
    }

    while (
      participants.length < requested &&
      this.createdPlayers < this.options.maxCreatedPlayers
    ) {
      participants.push(this.createNation(target));
    }

    return participants;
  }

  private createNation(target: Player): Player {
    let id: string;
    do {
      id = this.random.nextID();
    } while (this.mg.hasPlayer(id));

    this.createdPlayers++;
    const info = new PlayerInfo(
      `Breakaway ${this.createdPlayers}`,
      PlayerType.Nation,
      null,
      id,
    );
    return this.mg.addPlayer(info, target.team());
  }

  private clearAttacks(players: Player[]): void {
    const attacks = new Set(
      players.flatMap((player) => [
        ...player.outgoingAttacks(),
        ...player.incomingAttacks(),
      ]),
    );
    for (const attack of attacks) {
      attack.delete();
    }
  }

  private assignTiles(
    targetTiles: TileRef[],
    participants: Player[],
  ): Map<Player, TileRef[]> {
    const targetTileSet = new Set(targetTiles);
    const assigned = new Map<TileRef, Player>();
    const queue: Array<{ tile: TileRef; player: Player }> = [];
    const seeds = this.random
      .shuffleArray(targetTiles)
      .slice(0, participants.length);

    for (let i = 0; i < seeds.length; i++) {
      const tile = seeds[i];
      const player = participants[i];
      assigned.set(tile, player);
      queue.push({ tile, player });
    }

    this.growAssignments(queue, targetTileSet, assigned);

    let nextParticipant = 0;
    for (const tile of targetTiles) {
      if (assigned.has(tile)) {
        continue;
      }
      const player = participants[nextParticipant % participants.length];
      nextParticipant++;
      const componentQueue = [{ tile, player }];
      assigned.set(tile, player);
      this.growAssignments(componentQueue, targetTileSet, assigned);
    }

    const assignments = new Map<Player, TileRef[]>();
    for (const player of participants) {
      assignments.set(player, []);
    }
    for (const [tile, player] of assigned) {
      assignments.get(player)?.push(tile);
    }
    return assignments;
  }

  private growAssignments(
    queue: Array<{ tile: TileRef; player: Player }>,
    targetTileSet: Set<TileRef>,
    assigned: Map<TileRef, Player>,
  ): void {
    let index = 0;
    while (index < queue.length) {
      const { tile, player } = queue[index++];
      const numNeighbors = this.mg.map().neighbors4(tile, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const neighbor = this.nbuf[i];
        if (!targetTileSet.has(neighbor) || assigned.has(neighbor)) {
          continue;
        }
        assigned.set(neighbor, player);
        queue.push({ tile: neighbor, player });
      }
    }
  }

  private distributeResources(
    target: Player,
    participants: Player[],
    assignments: Map<Player, TileRef[]>,
    totalTiles: number,
    targetGold: bigint,
    targetTroops: number,
  ): void {
    let assignedGold = 0n;

    for (const player of participants) {
      const tiles = assignments.get(player) ?? [];
      if (tiles.length === 0) {
        continue;
      }

      if (!player.hasSpawned()) {
        player.setSpawnTile(tiles[0]);
      }

      const goldShare =
        (targetGold * BigInt(tiles.length)) / BigInt(totalTiles);
      assignedGold += goldShare;
      player.addGold(goldShare);

      const proportionalTroops = Math.floor(
        (targetTroops * tiles.length) / totalTiles,
      );
      const troops = Math.min(
        this.mg.config().maxTroops(player),
        Math.max(
          this.mg.config().startManpower(player.info()),
          proportionalTroops,
        ),
      );
      player.setTroops(troops);
    }

    if (targetGold > assignedGold) {
      target.addGold(targetGold - assignedGold);
    }
  }

  private addNationExecutions(player: Player): void {
    this.mg.addExecution(
      new PlayerExecution(player),
      new NationExecution(this.gameID, new Nation(undefined, player.info())),
    );
  }
}

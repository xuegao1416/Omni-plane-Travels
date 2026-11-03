/** Identity of the committed facts used by both narrative branches. */
export interface EvolutionFactIdentity {
  saveId: string;
  worldId: string;
  factVersion: string;
  turnId: string;
}

export interface EvolutionTurnTicket {
  readonly identity: Readonly<EvolutionFactIdentity>;
  readonly epoch: number;
  readonly signal: AbortSignal;
}

/** No worker owns live state. Only the caller at a safe boundary may commit. */
export class EvolutionTurnCoordinator {
  private epoch = 0;
  private controller: AbortController | undefined;

  invalidate(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.epoch += 1;
  }

  open(identity: EvolutionFactIdentity): EvolutionTurnTicket {
    this.invalidate();
    this.controller = new AbortController();
    return { identity: Object.freeze({ ...identity }), epoch: this.epoch, signal: this.controller.signal };
  }

  accepts(ticket: EvolutionTurnTicket, current: EvolutionFactIdentity): boolean {
    return !ticket.signal.aborted && ticket.epoch === this.epoch
      && ticket.identity.saveId === current.saveId
      && ticket.identity.worldId === current.worldId
      && ticket.identity.factVersion === current.factVersion
      && ticket.identity.turnId === current.turnId;
  }
}

/** Small hash, calculated only at review/commit, never included in model input. */
export function evolutionFactVersion(facts: unknown): string {
  const source = JSON.stringify(facts);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length}:${hash >>> 0}`;
}

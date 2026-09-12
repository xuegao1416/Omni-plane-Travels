import type { ApiConfig } from '../api/types';
import type { WorldDef } from '../data/worlds-schema';
import type { GameState } from '../schema/variables';
import type { SimulationState } from '../simulation/types';
import { EvolutionTurnCoordinator, evolutionFactVersion } from '../simulation/turnCoordinator';
import { alignDirectorPlans } from './align';
import { reconcileDirectorActors } from './actorIdentity';
import { applyDirectorDecision, requestDirectorDecision } from './client';
import type { OffscreenMemoryPort } from './memoryConsumer';
import { retryPendingOffscreenMemories, submitOffscreenEvent } from './offscreenPipeline';
import { evaluateDirectiveOutcome } from './outcome';
import { compileDirectorDirective, ensureDirectorState, getLatestDirectorDirective, migrateLegacySimulationToDirector } from './runtime';
import { refreshSourceExhaustion } from './sourceAdapter';
import type { DirectorReadContext, OffscreenEventProposal } from './types';

export interface DirectorStateHost { state: SimulationState; saveState: () => void }
export interface DirectorReviewInput {
  engine: DirectorStateHost;
  world: WorldDef;
  config: ApiConfig;
  saveId: string;
  turnId: string;
  round: number;
  narrative: string;
  playerInput?: string;
  getState: () => GameState;
  commitState: (state: GameState) => void;
  currentSaveId: () => string;
  currentWorldId: () => string;
  latestTurnId: () => string;
  getDirectorMemories?: () => DirectorReadContext['memories'];
  getOffscreenMemoryPort?: () => OffscreenMemoryPort | undefined;
  onCommitted: (branch: 'mainline' | 'background') => void;
  onMainlineBusy: (busy: boolean) => void;
  onBackgroundBusy: (busy: boolean) => void;
  onBackgroundError?: (message: string | null) => void;
  signal?: AbortSignal;
  canReview?: () => boolean;
}

export class DirectorReviewController {
  constructor(private readonly requestDecision: typeof requestDirectorDecision = requestDirectorDecision) {}
  private gate = new EvolutionTurnCoordinator();
  private foregroundBusy = true;
  private lastInput: DirectorReviewInput | undefined;
  invalidate(): void {
    this.gate.invalidate();
    this.lastInput?.onMainlineBusy(false);
    this.lastInput?.onBackgroundBusy(false);
    this.lastInput = undefined;
  }
  setForegroundBusy(busy: boolean): void { this.foregroundBusy = busy; }
  async retryMainline(): Promise<void> { if (!this.foregroundBusy && this.lastInput) await this.run({ ...this.lastInput, signal: undefined }); }
  async retryBackground(): Promise<void> { if (!this.foregroundBusy && this.lastInput) await this.run({ ...this.lastInput, signal: undefined }, { backgroundOnly: true }); }

  /** Await before narrative assembly; respects the current player input, including turn zero. */
  async prepareForTurn(input: {
    engine: DirectorStateHost; context: DirectorReadContext; world: WorldDef; config: ApiConfig;
    turnId: string; isCurrent: () => boolean; signal?: AbortSignal;
  }) {
    if (this.lastInput?.canReview && !this.lastInput.canReview()) return undefined;
    const simulation = structuredClone(input.engine.state);
    const director = migrateLegacySimulationToDirector(simulation);
    reconcileDirectorActors(director, input.context.variableProjection.人物档案);
    alignDirectorPlans(director, input.context);
    refreshSourceExhaustion(director);
    if (simulation.config.enabled) {
      const decision = await this.requestDecision(director, input.context, input.world.description || input.world.name, input.config, input.signal);
      if (input.signal?.aborted || !input.isCurrent()) return undefined;
      applyDirectorDecision(director, decision, input.context);
      alignDirectorPlans(director, input.context);
      refreshSourceExhaustion(director);
    }
    if (input.signal?.aborted || !input.isCurrent()) return undefined;
    const directive = simulation.config.enabled ? compileDirectorDirective(simulation, input.context.completedTurnId, input.context.stateVersion, input.context.saveId, input.turnId) : undefined;
    input.engine.state.director = director;
    input.engine.saveState();
    return directive;
  }

  /** One awaited review after committed variables/memory; no independent background worker. */
  async run(input: DirectorReviewInput, options: { backgroundOnly?: boolean; sourceAndOutcomeOnly?: boolean; forceBackground?: boolean } = {}): Promise<void> {
    if (!input.narrative.trim()) return;
    if (input.saveId !== input.currentSaveId() || input.world.id !== input.currentWorldId() || input.turnId !== input.latestTurnId()) return;
    this.lastInput = input;
    const writesCommitted = !input.canReview || input.canReview();
    ensureDirectorState(input.engine.state).pendingReview = { saveId: input.saveId, worldId: input.world.id, turnId: input.turnId, round: input.round, writesCommitted };
    input.engine.saveState();
    if (!writesCommitted) {
      input.onBackgroundError?.('变量或记忆写入尚未成功，剧情导演暂缓推进；重试完成后会继续核对本轮。');
      return;
    }
    let expectedVersion = evolutionFactVersion(input.getState());
    const ticket = this.gate.open({ saveId: input.saveId, worldId: input.world.id, turnId: input.turnId, factVersion: expectedVersion });
    const signal = input.signal ? AbortSignal.any([input.signal, ticket.signal]) : ticket.signal;
    const isCurrent = () => !signal.aborted && input.saveId === input.currentSaveId() && input.world.id === input.currentWorldId() && input.turnId === input.latestTurnId() && expectedVersion === evolutionFactVersion(input.getState());
    const simulation = structuredClone(input.engine.state);
    const director = migrateLegacySimulationToDirector(simulation);
    const context: DirectorReadContext = { saveId: input.saveId, worldId: input.world.id, completedTurnId: input.turnId, stateVersion: expectedVersion, variableProjection: structuredClone(input.getState()), narrative: input.narrative, playerInput: input.playerInput, memories: input.getDirectorMemories?.() ?? [] };
    reconcileDirectorActors(director, context.variableProjection.人物档案);
    const persist = () => { input.engine.state.director = director; input.engine.saveState(); };
    try {
      input.onMainlineBusy(true);
      const directive = getLatestDirectorDirective(simulation);
      if (!options.backgroundOnly && directive && (directive.issuedForTurnId ? directive.issuedForTurnId === input.turnId : directive.basedOnTurnId !== input.turnId)) {
        await evaluateDirectiveOutcome({ director, directive, narrative: input.narrative, turnId: input.turnId, stateVersion: expectedVersion, config: input.config, signal });
        if (!isCurrent()) return;
      }
      alignDirectorPlans(director, context);
      refreshSourceExhaustion(director);
      // Keep accepted narrative progress even if subsequent planning fails.
      if (!isCurrent()) return;
      persist();
      input.onMainlineBusy(false);
      if (simulation.config.enabled && !options.sourceAndOutcomeOnly) {
        input.onBackgroundBusy(true);
        const decision = await this.requestDecision(director, context, input.world.description || input.world.name, input.config, signal);
        if (!isCurrent()) return;
        applyDirectorDecision(director, decision, context);
        alignDirectorPlans(director, context);
        refreshSourceExhaustion(director);
        for (const candidate of decision.offscreen) {
          const plan = director.plans[candidate.planId];
          if (!plan || plan.status !== 'ready' || plan.visibility === 'foreground' || (plan.stageId && plan.stageId !== director.sourceBinding?.currentStageId)) continue;
          const key = `${plan.id}:${candidate.kind}`;
          const proposal: OffscreenEventProposal = {
            planId: plan.id, worldId: input.world.id, basedOnTurnId: input.turnId,
            proposalId: `proposal:${key}`, logicalEventKey: key, directorRunId: `review:${input.turnId}`, saveId: input.saveId,
            baseStateVersion: expectedVersion, kind: candidate.kind, subjectIds: candidate.subjectIds,
            prerequisites: [],
            occurredAt: input.getState().世界.时间系统.当前时间, visibility: candidate.kind === 'world_event' ? 'reader_only' : plan.visibility,
            description: candidate.description, payload: candidate.kind === 'character_moved' ? { location: candidate.value } : candidate.kind === 'character_injured' ? { status: candidate.value } : {}, createdAt: Date.now(),
          };
          if (!isCurrent()) return;
          // Commit variable transaction and its receipt before the memory consumer may await.
          const result = await submitOffscreenEvent({ proposal, director, gameState: input.getState(), currentStateVersion: expectedVersion, context: { ...context, stateVersion: expectedVersion, variableProjection: input.getState() } });
          if (!isCurrent()) return;
          if (result.receipt.status === 'accepted') {
            input.commitState(result.state);
            expectedVersion = evolutionFactVersion(input.getState());
          }
          persist();
        }
      }
      if (!isCurrent()) return;
      const port = input.getOffscreenMemoryPort?.();
      if (port) {
        await retryPendingOffscreenMemories(director, {
          hasOffscreenFact: port.hasOffscreenFact,
          appendAcceptedEvent: async event => { if (!isCurrent()) throw new Error('幕后记忆所属存档已变化'); await port.appendAcceptedEvent(event); },
        });
        if (!isCurrent()) return;
      }
      for (const [key, receipt] of Object.entries(director.offscreenReceipts)) {
        const proposal = director.offscreenProposals[key];
        const plan = proposal?.planId ? director.plans[proposal.planId] : undefined;
        if (plan && receipt.status === 'accepted' && receipt.consumers.variables === 'done' && receipt.consumers.memory === 'done') {
          plan.status = 'occurred';
          plan.lastReceiptId = receipt.id;
        }
      }
      refreshSourceExhaustion(director);
      const incompleteMemory = Object.values(director.offscreenReceipts).some(receipt => receipt.status === 'accepted' && receipt.consumers.memory !== 'done');
      if (!incompleteMemory) delete director.pendingReview;
      persist();
      input.onBackgroundError?.(incompleteMemory ? '部分幕后记忆尚未写入，重试只补交未完成的消费者。' : null);
      input.onCommitted('mainline');
    } catch (error) {
      if (!signal.aborted && isCurrent()) input.onBackgroundError?.(`剧情导演未完成：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      input.onMainlineBusy(false);
      input.onBackgroundBusy(false);
    }
  }
}

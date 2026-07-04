// 事件总线 - 替代SillyTavern tavern_events
type EventHandler = (...args: any[]) => void;

class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: EventHandler) {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: any[]) {
    this.handlers.get(event)?.forEach(fn => {
      try { fn(...args); } catch (e) { console.error(`[EventBus] ${event} handler error:`, e); }
    });
  }

  once(event: string, handler: EventHandler) {
    const wrapped = (...args: any[]) => {
      this.off(event, wrapped);
      handler(...args);
    };
    this.on(event, wrapped);
  }
}

export const eventBus = new EventBus();

// 事件常量
export const EVENTS = {
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_SENT: 'message_sent',
  GENERATION_STARTED: 'generation_started',
  GENERATION_ENDED: 'generation_ended',
  GENERATION_STOPPED: 'generation_stopped',
  VARIABLE_UPDATE_ENDED: 'variable_update_ended',
  VARIABLE_EXTRACTION_FAILED: 'variable_extraction_failed',
  CHAT_CHANGED: 'chat_changed',
  AUTO_SAVE: 'auto_save',
  PIPELINE_UPDATE: 'pipeline_update',
} as const;

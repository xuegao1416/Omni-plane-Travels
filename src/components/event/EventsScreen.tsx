import { useEffect, useState } from 'react';
import { useGame } from '../../context/GameContext';
import { ensureCacheListener } from '../../modules/eventApi';
import { isTauri } from '../../utils/nativeFetch';
import type { EventRegistryEntry, EventPackType } from '../../modules/schema';
import { createRule, createEmptyPack } from '../../modules/webEventStore';
import { useEvents } from './useEvents';
import EventLibrary from './EventLibrary';
import EventArchiveWorkspace from './EventArchiveWorkspace';
import CardEditor from './CardEditor';
import EventErrorBoundary from './EventErrorBoundary';
import WorkflowEditor from '../workflow/WorkflowEditor';
import EventImportWizard from './EventImportWizard';
import AiEventGenerator from './AiEventGenerator';
import './event.css';

type SubView = 'center' | 'library' | 'card' | 'rule' | 'wizard' | 'ai-generator';

function subViewForType(type: EventPackType): SubView {
  if (type === 'rule') return 'rule';
  return 'card';
}

export default function EventsScreen() {
  const { navigate } = useGame();
  const eventApi = useEvents();
  const [subView, setSubView] = useState<SubView>('center');
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);

  useEffect(() => {
    void ensureCacheListener();
  }, []);

  useEffect(() => {
    if (subView === 'center' && !selectedPackId && eventApi.packs.length > 0) {
      setSelectedPackId(eventApi.packs[0].meta.id);
    }
  }, [eventApi.packs, selectedPackId, subView]);

  const handleOpenPack = (entry: EventRegistryEntry) => {
    setSelectedPackId(entry.meta.id);
    setSubView(subViewForType(entry.meta.type));
  };

  const handleNewPack = async () => {
    const packId = await createEmptyPack('我的卡片事件包');
    void eventApi.refresh();
    setSelectedPackId(packId);
    setSubView('card');
  };

  const handleNewRule = async () => {
    try {
      const id = await createRule();
      setSelectedPackId(id);
      setSubView('rule');
    } catch (error) {
      console.error('[EventsScreen] 创建工作流失败:', error);
    }
  };

  const handleAiSaved = (packId: string, type: 'card' | 'rule') => {
    void eventApi.refresh();
    setSelectedPackId(packId);
    setSubView(type === 'rule' ? 'rule' : 'card');
  };

  const handleImport = () => {
    if (isTauri()) {
      void eventApi.importPack();
    } else {
      setSubView('wizard');
    }
  };

  const goCenter = () => setSubView('center');

  if (subView === 'center' || subView === 'library') {
    return (
      <EventArchiveWorkspace
        eventApi={eventApi}
        tab={subView}
        selectedPackId={selectedPackId}
        onSelectPack={setSelectedPackId}
        onChangeTab={setSubView}
        onBack={() => navigate('start')}
        onImport={handleImport}
        onNewPack={() => void handleNewPack()}
        onNewRule={() => void handleNewRule()}
        onAiGenerate={() => setSubView('ai-generator')}
        onOpenPack={handleOpenPack}
        libraryContent={<EventLibrary eventApi={eventApi} onOpenPack={handleOpenPack} />}
      />
    );
  }

  return (
    <div className="full-height" style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
        {subView === 'card' && selectedPackId && (
          <EventErrorBoundary onBack={goCenter}>
            <CardEditor eventPackId={selectedPackId} onBack={goCenter} onSaved={() => void eventApi.refresh()} />
          </EventErrorBoundary>
        )}
        {subView === 'rule' && (
          <EventErrorBoundary onBack={goCenter}>
            <WorkflowEditor eventPackId={selectedPackId} onBack={goCenter} onSaved={() => void eventApi.refresh()} />
          </EventErrorBoundary>
        )}
        {subView === 'wizard' && (
          <EventErrorBoundary onBack={goCenter}>
            <EventImportWizard eventApi={eventApi} eventPackId={selectedPackId} onClose={goCenter} />
          </EventErrorBoundary>
        )}
        {subView === 'ai-generator' && (
          <EventErrorBoundary onBack={goCenter}>
            <AiEventGenerator onBack={goCenter} onSaved={handleAiSaved} />
          </EventErrorBoundary>
        )}
      </div>
    </div>
  );
}

export interface JourneyDossierContentProps {
  panel: string;
  children: React.ReactNode;
}

/** Shared content presentation boundary used by live panels and DEV mock data. */
export default function JourneyDossierContent({ panel, children }: JourneyDossierContentProps) {
  return <div className={`journey-dossier-content journey-dossier-content--${panel}`} data-dossier-panel={panel}>{children}</div>;
}

export function DossierSection({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return <section className="journey-dossier-section"><h3>{icon}{title}</h3><div className="journey-dossier-section__body">{children}</div></section>;
}

export function DossierValueList({ values }: { values: Array<{ label: string; value: React.ReactNode }> }) {
  return <dl className="journey-dossier-value-list">{values.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}

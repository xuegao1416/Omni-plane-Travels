interface DialoguePayload {
  avatar: string;
  name: string;
  title: string;
  text: string;
  action: string;
}

interface DialogueMarker {
  marker: string;
  fields: { avatar: string; name: string; title: string; text: string; action: string };
}

const DIALOGUE_MARKERS: DialogueMarker[] = [
  { marker: '[SPEAK]', fields: { avatar: 'img', name: 'who', title: 'sub', text: 'msg', action: 'act' } },
  { marker: '/ui:DL', fields: { avatar: 'av', name: 'nm', title: 'tt', text: 'tx', action: 'ac' } },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function findNextMarker(text: string, from: number): { index: number; config: DialogueMarker } | null {
  const lower = text.toLowerCase();
  let found: { index: number; config: DialogueMarker } | null = null;
  for (const config of DIALOGUE_MARKERS) {
    const index = lower.indexOf(config.marker.toLowerCase(), from);
    if (index >= 0 && (!found || index < found.index)) found = { index, config };
  }
  return found;
}

function findJsonEnd(text: string, start: number): number | null {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return index + 1;
  }
  return null;
}

function parsePayload(raw: string, config: DialogueMarker): DialoguePayload | null {
  try {
    const value = JSON.parse(raw);
    if (!isRecord(value)) return null;
    const read = (field: string) => typeof value[field] === 'string' ? value[field] as string : '';
    const payload = {
      avatar: read(config.fields.avatar),
      name: read(config.fields.name).trim(),
      title: read(config.fields.title).trim(),
      text: read(config.fields.text),
      action: read(config.fields.action),
    };
    return payload.name && payload.text ? payload : null;
  } catch {
    return null;
  }
}

function transformDialogueMarkup(text: string, render: (payload: DialoguePayload) => string): string {
  if (!text) return text;
  let cursor = 0;
  let result = '';
  while (cursor < text.length) {
    const found = findNextMarker(text, cursor);
    if (!found) return result + text.slice(cursor);
    result += text.slice(cursor, found.index);
    let jsonStart = found.index + found.config.marker.length;
    while (/\s/.test(text[jsonStart] || '')) jsonStart += 1;
    const jsonEnd = findJsonEnd(text, jsonStart);
    if (jsonEnd == null) return result + text.slice(found.index);
    const rawBlock = text.slice(found.index, jsonEnd);
    const payload = parsePayload(text.slice(jsonStart, jsonEnd), found.config);
    result += payload ? render(payload) : rawBlock;
    cursor = jsonEnd;
  }
  return result;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Converts explicit dialogue protocol blocks to inert mount points after generation completes. */
export function renderDialogueMarkup(text: string): string {
  return transformDialogueMarkup(text, payload => {
    const avatar = escapeHtmlAttribute(payload.avatar);
    const name = escapeHtmlAttribute(payload.name);
    const title = escapeHtmlAttribute(payload.title);
    const dialogue = escapeHtmlAttribute(payload.text);
    const action = escapeHtmlAttribute(payload.action);
    const initial = escapeHtmlAttribute(Array.from(payload.name)[0] || '?');
    const avatarImage = avatar
      ? `<img class="inline-dialogue-card__avatar-image" src="${avatar}" alt="" loading="lazy" />`
      : '';
    const titleMarkup = title ? `<span class="inline-dialogue-card__title">${title}</span>` : '';
    const actionMarkup = action ? `<div class="inline-dialogue-card__action">${action}</div>` : '';

    return `<div class="inline-dialogue-card" data-avatar="${avatar}" data-name="${name}" data-npcid="${name}"><div class="inline-dialogue-card__identity"><div class="inline-dialogue-card__avatar" aria-hidden="true"><span class="inline-dialogue-card__initial">${initial}</span>${avatarImage}</div><div class="inline-dialogue-card__speaker"><span class="inline-dialogue-card__name">${name}</span>${titleMarkup}</div></div><div class="inline-dialogue-card__bubble"><i class="inline-dialogue-card__tail" aria-hidden="true"></i><div class="inline-dialogue-card__text">${dialogue}</div>${actionMarkup}</div></div>`;
  });
}

/** Converts explicit dialogue protocol blocks to readable text for the copy action. */
export function dialogueMarkupToPlainText(text: string): string {
  return transformDialogueMarkup(text, payload => {
    const speaker = payload.title ? `${payload.name} · ${payload.title}` : payload.name;
    return `${speaker}：${payload.text}${payload.action ? `\n（${payload.action}）` : ''}`;
  });
}

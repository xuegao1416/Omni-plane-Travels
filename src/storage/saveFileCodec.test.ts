import { describe, expect, test } from 'bun:test';
import JSZip from 'jszip';
import { decodeSaveFile, encodeSaveFile, SAVE_FILE_ACCEPT, SAVE_FILE_EXTENSION } from './saveFileCodec';

const payload = {
  type: 'omni-plane-travels-save', version: '2.0',
  save: {
    messages: [{ rawText: '篝火旁的正文。'.repeat(10_000), snapshot: { round: 60 } }],
    customWorld: { name: '黑森箱庭' },
    simulationState: { snapshots: [{ round: 0 }, { round: 60 }] },
    moduleCheckpoints: [{ moduleId: 'stat', revision: 60 }],
  },
};

describe('save file transport', () => {
  test('compresses the complete envelope and preserves JSON bytes in a standard ZIP', async () => {
    const json = JSON.stringify(payload, null, 2);
    const compressed = await encodeSaveFile(new Blob([json], { type: 'application/json' }));
    expect(compressed.type).toBe('application/zip');
    expect(compressed.size).toBeLessThan(new Blob([json]).size / 10);
    const zip = await JSZip.loadAsync(await compressed.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(['save.json']);
    expect(await zip.file('save.json')!.async('string')).toBe(json);
    expect(await decodeSaveFile(compressed)).toEqual(payload);
    expect(SAVE_FILE_EXTENSION).toBe('.save.zip');
    expect(SAVE_FILE_ACCEPT).toContain('.json');
    expect(SAVE_FILE_ACCEPT).toContain('.zip');
  });

  test('accepts old JSON and identifies content regardless of filename or MIME', async () => {
    expect(await decodeSaveFile(new Blob([JSON.stringify(payload)], { type: 'application/zip' }))).toEqual(payload);
    const compressed = await encodeSaveFile(new Blob([JSON.stringify(payload)]));
    expect(await decodeSaveFile(new Blob([await compressed.arrayBuffer()], { type: 'application/json' }))).toEqual(payload);
  });

  test('rejects malformed JSON, broken ZIP, and unrelated delivery archives clearly', async () => {
    await expect(decodeSaveFile(new Blob(['{broken']))).rejects.toThrow('JSON');
    await expect(decodeSaveFile(new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])]))).rejects.toThrow('损坏');
    const unrelated = await new JSZip().file('世界.json', '{}').generateAsync({ type: 'uint8array' });
    await expect(decodeSaveFile(new Blob([new Uint8Array(unrelated)]))).rejects.toThrow('save.json');
    const brokenJson = await new JSZip().file('save.json', '{broken').generateAsync({ type: 'uint8array' });
    await expect(decodeSaveFile(new Blob([new Uint8Array(brokenJson)]))).rejects.toThrow('JSON');
  });
});

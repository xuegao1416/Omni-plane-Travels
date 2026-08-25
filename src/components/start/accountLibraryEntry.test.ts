import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('hall account and library entry contract', () => {
  test('keeps settings separate and routes the account control to the user center', () => {
    const startScreen = read('./StartScreen.tsx');
    const hall = read('./WorldHallView.tsx');
    const app = read('../../App.tsx');

    expect(startScreen).toContain('onOpenSettings');
    expect(startScreen).toContain("h.navigate('settings')");
    expect(startScreen).toContain("h.navigate('user-center')");
    expect(hall).toContain('onOpenSettings: () => void;');
    expect(hall).toContain('onClick={onOpenSettings}');
    expect(hall).toContain('onClick={onOpenUserCenter}');
    expect(startScreen).toContain("omni.user-center.initial-tab', 'workshop'");
    expect(hall).toContain('onOpenWorkshop: () => void;');
    expect(startScreen).toContain('onOpenWorkshop={() =>');
    expect(app).toContain("case 'user-center': return <UserCenterPage />;");
    expect(hall).toContain('setArchiveOpen(true)');
  });
});

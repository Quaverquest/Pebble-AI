import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertModelCanUseTool,
  canModelControlPc,
  getAllowedAgentTools,
  isUncensoredModelOrRouter,
  parsePcControlCommand,
} from './safety';
import type { ModelEntry } from './types';

const censoredModel: Pick<ModelEntry, 'id' | 'name' | 'censorship'> = {
  id: 'pebble-chat-normal',
  name: 'Pebble AI Chat Normal',
  censorship: 'censored',
};

const uncensoredModel: Pick<ModelEntry, 'id' | 'name' | 'censorship'> = {
  id: 'pebble-chat-normal-uncensored',
  name: 'Pebble AI Chat Normal (Uncensored)',
  censorship: 'uncensored',
};

test('censored models are allowed to control host PC mouse, keyboard, and workspace files', () => {
  assert.equal(isUncensoredModelOrRouter(censoredModel, 'omni'), false);
  const check = canModelControlPc(censoredModel, 'omni');
  assert.equal(check.allowed, true);

  assert.doesNotThrow(() => assertModelCanUseTool('mouse_move', censoredModel, 'omni'));
  assert.doesNotThrow(() => assertModelCanUseTool('mouse_click', censoredModel, 'omni'));
  assert.doesNotThrow(() => assertModelCanUseTool('keyboard_type', censoredModel, 'omni'));
  assert.doesNotThrow(() => assertModelCanUseTool('keyboard_hotkey', censoredModel, 'omni'));
  assert.doesNotThrow(() => assertModelCanUseTool('write_file', censoredModel, 'omni'));

  const tools = getAllowedAgentTools(censoredModel, 'omni');
  assert.ok(tools.includes('mouse_click'));
  assert.ok(tools.includes('keyboard_type'));
  assert.ok(tools.includes('list_files'));
});

test('uncensored models are strictly denied ALL PC mouse, keyboard, and file access', () => {
  assert.equal(isUncensoredModelOrRouter(uncensoredModel, 'omni'), true);
  assert.equal(canModelControlPc(uncensoredModel, 'omni').allowed, false);

  for (const restrictedTool of [
    'mouse_move',
    'mouse_click',
    'mouse_scroll',
    'keyboard_type',
    'keyboard_hotkey',
    'list_files',
    'read_file',
    'write_file',
    'create_directory',
    'search_files',
  ]) {
    assert.throws(
      () => assertModelCanUseTool(restrictedTool, uncensoredModel, 'omni'),
      /uncensored/i
    );
  }

  // Uncensored models are permitted ONLY non-PC chat/reasoning & image generation
  assert.doesNotThrow(() => assertModelCanUseTool('reason_summary', uncensoredModel, 'omni'));
  assert.doesNotThrow(() => assertModelCanUseTool('generate_image', uncensoredModel, 'omni'));

  assert.deepEqual(getAllowedAgentTools(uncensoredModel, 'omni'), [
    'reason_summary',
    'generate_image',
  ]);
});

test('uncensored router blocks PC control even if paired with a censored fallback model', () => {
  assert.equal(canModelControlPc(censoredModel, 'uncensored').allowed, false);
  assert.throws(() => assertModelCanUseTool('keyboard_hotkey', censoredModel, 'uncensored'));
  assert.deepEqual(getAllowedAgentTools(censoredModel, 'uncensored'), [
    'reason_summary',
    'generate_image',
  ]);
});

test('parsePcControlCommand extracts mouse coordinates, clicks, scroll, typing, and hotkeys', () => {
  const move = parsePcControlCommand('Move mouse to 640, 380');
  assert.equal(move?.action, 'mouse_move');
  assert.equal(move?.x, 640);
  assert.equal(move?.y, 380);

  const click = parsePcControlCommand('Double click at 400, 220');
  assert.equal(click?.action, 'mouse_click');
  assert.equal(click?.doubleClick, true);
  assert.equal(click?.x, 400);
  assert.equal(click?.y, 220);

  const scroll = parsePcControlCommand('scroll down 4');
  assert.equal(scroll?.action, 'mouse_scroll');
  assert.ok((scroll?.deltaY ?? 0) < 0);

  const typeCmd = parsePcControlCommand('Type "hello pebble"');
  assert.equal(typeCmd?.action, 'keyboard_type');
  assert.equal(typeCmd?.text, 'hello pebble');

  const hotkey = parsePcControlCommand('Press ctrl+c');
  assert.equal(hotkey?.action, 'keyboard_hotkey');
  assert.deepEqual(hotkey?.keys, ['ctrl', 'c']);
});

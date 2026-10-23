import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

test('Full-stack multiplayer server file server.ts exists and provides WebSocket and REST room management', () => {
  const serverPath = path.join(ROOT, 'server.ts');
  assert.ok(fs.existsSync(serverPath), 'server.ts must exist for full-stack multiplayer');
  const content = fs.readFileSync(serverPath, 'utf-8');

  assert.ok(content.includes('WebSocketServer'), 'server.ts must configure WebSocketServer');
  assert.ok(content.includes('/api/rooms/create'), 'server.ts must define /api/rooms/create');
  assert.ok(content.includes('/api/rooms/join'), 'server.ts must define /api/rooms/join');
  assert.ok(content.includes('/api/rooms/:code/move'), 'server.ts must define move broadcasting');
  assert.ok(content.includes('/api/rooms/public'), 'server.ts must define public rooms endpoint');
});

test('App.tsx contains multiplayer controls and modal', () => {
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');

  assert.ok(appTsx.includes('btn-open-multiplayer') || appTsx.includes('btn-multiplayer'), 'App.tsx must have multiplayer button');
  assert.ok(appTsx.includes('multiplayer-modal'), 'App.tsx must contain multiplayer-modal dialog');
  assert.ok(appTsx.includes('Pass &amp; Play (2P)') || appTsx.includes('Pass & Play'), 'App.tsx must support Pass & Play mode');
  assert.ok(appTsx.includes('handleCreateRoom'), 'App.tsx must handle chamber creation');
  assert.ok(appTsx.includes('handleJoinRoom'), 'App.tsx must handle chamber joining');
});

test('wizardChessEngine.js exports complete multiplayer API on window.wizardChess', () => {
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');

  assert.ok(engineJs.includes('createMultiplayerRoom'), 'wizardChessEngine must export createMultiplayerRoom');
  assert.ok(engineJs.includes('joinMultiplayerRoom'), 'wizardChessEngine must export joinMultiplayerRoom');
  assert.ok(engineJs.includes('leaveMultiplayerRoom'), 'wizardChessEngine must export leaveMultiplayerRoom');
  assert.ok(engineJs.includes('sendMultiplayerChat'), 'wizardChessEngine must export sendMultiplayerChat');
  assert.ok(engineJs.includes('setGameMode'), 'wizardChessEngine must export setGameMode');
  assert.ok(engineJs.includes('connectMpWebSocket'), 'wizardChessEngine must support real-time WebSocket connection');
});

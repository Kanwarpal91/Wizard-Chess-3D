import { useEffect, useRef, useState, useCallback } from 'react';
import { initWizardChess } from './wizardChessEngine.js';

interface RoomPayload {
  code: string;
  status: 'waiting' | 'playing' | 'checkmate' | 'draw';
  whiteJoined: boolean;
  blackJoined: boolean;
  turn: 'w' | 'b';
  moves: unknown[];
  messages: Array<{ id: string; color: string; name: string; text: string; ts: number }>;
  resetCount: number;
  whiteName?: string;
  blackName?: string;
  whiteConnected?: boolean;
  blackConnected?: boolean;
  updatedAt?: number;
}

interface PublicRoom {
  code: string;
  status: string;
  whiteJoined: boolean;
  blackJoined: boolean;
  moveCount: number;
  updatedAt: number;
}

export default function App() {
  const initializedRef = useRef(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [isMultiplayerOpen, setIsMultiplayerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'online' | 'local' | 'single'>('online');
  const [selectedColor, setSelectedColor] = useState<'w' | 'b' | 'random'>('w');
  const [playerName, setPlayerName] = useState(() => {
    try {
      return localStorage.getItem('wizard_chess_name') || 'Sanctum Mage';
    } catch {
      return 'Sanctum Mage';
    }
  });
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [roomData, setRoomData] = useState<RoomPayload | null>(null);
  const [gameMode, setGameMode] = useState<'single' | 'multi' | 'local2p'>('single');
  const [autoFlipCamera, setAutoFlipCamera] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [chatText, setChatText] = useState('');
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const toastTimeoutRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  }, []);

  const fetchPublicRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/rooms/public');
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.rooms)) {
          setPublicRooms(data.rooms);
        }
      }
    } catch {
      // Offline or static fallback
    }
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    initWizardChess();
  }, []);

  useEffect(() => {
    const handleRoomUpdated = (e: Event) => {
      const custom = e as CustomEvent<RoomPayload | null>;
      setRoomData(custom.detail);
      if (custom.detail) {
        setGameMode('multi');
      } else {
        setGameMode('single');
      }
    };

    const handleTurnChanged = (e: Event) => {
      const custom = e as CustomEvent<{ gameMode: 'single' | 'multi' | 'local2p' }>;
      if (custom.detail?.gameMode) {
        setGameMode(custom.detail.gameMode);
      }
    };

    const handleChat = (e: Event) => {
      const custom = e as CustomEvent<{ name: string; text: string }>;
      if (custom.detail && !isMultiplayerOpen) {
        showToast(`${custom.detail.name}: ${custom.detail.text}`);
      }
    };

    window.addEventListener('wizardChess:roomUpdated', handleRoomUpdated);
    window.addEventListener('wizardChess:turnChanged', handleTurnChanged);
    window.addEventListener('wizardChess:chat', handleChat);

    return () => {
      window.removeEventListener('wizardChess:roomUpdated', handleRoomUpdated);
      window.removeEventListener('wizardChess:turnChanged', handleTurnChanged);
      window.removeEventListener('wizardChess:chat', handleChat);
    };
  }, [isMultiplayerOpen, showToast]);

  useEffect(() => {
    if (isMultiplayerOpen && activeTab === 'online') {
      fetchPublicRooms();
      const interval = setInterval(fetchPublicRooms, 5000);
      return () => clearInterval(interval);
    }
  }, [isMultiplayerOpen, activeTab, fetchPublicRooms]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileSheetOpen(false);
        setIsMultiplayerOpen(false);
      }
    };
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setMobileSheetOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleRestoreUI = () => {
    const win = window as unknown as { wizardChess?: { toggleUI?: (force?: boolean) => void } };
    if (win.wizardChess?.toggleUI) {
      win.wizardChess.toggleUI(false);
    } else {
      document.body.classList.remove('cinematic-ui-hidden');
      const btnHide = document.getElementById('btn-hide-ui');
      if (btnHide) btnHide.textContent = 'Hide UI [H]';
    }
  };

  const handleCreateRoom = async () => {
    const win = window as unknown as {
      wizardChess?: {
        createMultiplayerRoom?: (color: string, name: string) => Promise<{ ok: boolean; code: string }>;
      };
    };
    if (!win.wizardChess?.createMultiplayerRoom) return;
    setIsCreating(true);
    try {
      localStorage.setItem('wizard_chess_name', playerName);
      const res = await win.wizardChess.createMultiplayerRoom(selectedColor, playerName);
      if (res?.ok) {
        showToast(`Chamber ${res.code} summoned! Share code with your rival.`);
      }
    } catch {
      showToast('Error summoning chamber. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async (codeToJoin?: string) => {
    const code = (codeToJoin || roomCodeInput).trim().toUpperCase();
    if (!code) {
      showToast('Please enter a Room Code.');
      return;
    }
    const win = window as unknown as {
      wizardChess?: {
        joinMultiplayerRoom?: (code: string, name: string) => Promise<{ ok: boolean }>;
      };
    };
    if (!win.wizardChess?.joinMultiplayerRoom) return;
    setIsJoining(true);
    try {
      localStorage.setItem('wizard_chess_name', playerName);
      const res = await win.wizardChess.joinMultiplayerRoom(code, playerName);
      if (res?.ok) {
        showToast(`Joined Chamber ${code}! Duel starting.`);
      } else {
        showToast(`Chamber ${code} not found. Check code.`);
      }
    } catch {
      showToast('Could not join room.');
    } finally {
      setIsJoining(false);
    }
  };

  const handleLeaveRoom = () => {
    const win = window as unknown as { wizardChess?: { leaveMultiplayerRoom?: () => void } };
    if (win.wizardChess?.leaveMultiplayerRoom) {
      win.wizardChess.leaveMultiplayerRoom();
      setRoomData(null);
      setGameMode('single');
      showToast('Left multiplayer room.');
    }
  };

  const handleSendChat = (textToSend?: string) => {
    const text = (textToSend || chatText).trim();
    if (!text) return;
    const win = window as unknown as { wizardChess?: { sendMultiplayerChat?: (t: string) => void } };
    if (win.wizardChess?.sendMultiplayerChat) {
      win.wizardChess.sendMultiplayerChat(text);
      setChatText('');
    }
  };

  const handleCopyCode = () => {
    if (!roomData?.code) return;
    navigator.clipboard?.writeText(roomData.code);
    showToast(`Copied Room Code ${roomData.code}!`);
  };

  const handleCopyLink = () => {
    if (!roomData?.code) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${roomData.code}`;
    navigator.clipboard?.writeText(url);
    showToast('Copied duel invite link to clipboard!');
  };

  const handleStartLocal2P = () => {
    const win = window as unknown as {
      wizardChess?: { setGameMode?: (mode: string, opts?: { autoFlip?: boolean }) => void };
    };
    if (win.wizardChess?.setGameMode) {
      win.wizardChess.setGameMode('local2p', { autoFlip: autoFlipCamera });
      setGameMode('local2p');
      setIsMultiplayerOpen(false);
      showToast('Pass & Play 2-Player mode active!');
    }
  };

  const handleStartSinglePlayer = (color: 'w' | 'b') => {
    const win = window as unknown as {
      wizardChess?: { setGameMode?: (mode: string, opts?: { color?: string }) => void };
    };
    if (win.wizardChess?.setGameMode) {
      win.wizardChess.setGameMode('single', { color });
      setGameMode('single');
      setIsMultiplayerOpen(false);
      showToast(`Single-player AI match started as ${color === 'w' ? 'White' : 'Black'}.`);
    }
  };

  const bothPlayersConnected = Boolean(roomData && roomData.whiteJoined && roomData.blackJoined);

  return (
    <>
      <div id="loading-overlay">
        <div className="loader-title">Wizard Chess</div>
        <div className="loader-bar-wrap">
          <div className="loader-bar" id="loader-bar"></div>
        </div>
        <div id="loader-text">Summoning Sanctum Architecture &amp; Sculpted Pieces...</div>
      </div>

      <div id="canvas-container"></div>

      {toastMessage && (
        <div className="mp-toast" role="alert">
          {toastMessage}
        </div>
      )}

      <button
        type="button"
        className="hud-btn mobile-only-restore-ui"
        id="btn-mobile-show-ui"
        onClick={handleRestoreUI}
        title="Show HUD Controls"
      >
        Show UI
      </button>

      <div id="hud-top">
        <div className="hud-group" id="hud-left">
          <div className="brand-pill">
            <span className="brand-title">Wizard Chess</span>
          </div>
          <div className="status-pill" id="status-pill">
            <span className="turn-dot" id="turn-dot"></span>
            <span id="turn-text">White to Move</span>
            <span className="mode-badge" id="mode-badge">
              {gameMode === 'multi'
                ? 'Online Duel'
                : gameMode === 'local2p'
                ? 'Pass & Play (2P)'
                : 'Playing as White'}
            </span>
          </div>

          {roomData && (
            <button
              type="button"
              className="hud-btn primary"
              id="hud-chamber-badge"
              onClick={() => setIsMultiplayerOpen(true)}
              title="View Multiplayer Chamber"
            >
              Chamber: {roomData.code} ({bothPlayersConnected ? '2/2 In Duel' : '1/2 Waiting'})
            </button>
          )}

          <button
            type="button"
            className="hud-btn primary"
            id="btn-open-multiplayer"
            onClick={() => setIsMultiplayerOpen(true)}
            title="Open Multiplayer & Game Modes"
          >
            Multiplayer
          </button>
        </div>

        <button
          type="button"
          className={`hud-btn mobile-controls-trigger ${mobileSheetOpen ? 'active' : ''}`}
          id="btn-mobile-controls"
          aria-expanded={mobileSheetOpen}
          aria-controls="hud-right"
          onClick={() => setMobileSheetOpen((prev) => !prev)}
        >
          {mobileSheetOpen ? 'Close' : 'Controls'}
        </button>

        <div
          className={`mobile-sheet-backdrop ${mobileSheetOpen ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setMobileSheetOpen(false);
          }}
          aria-hidden="true"
        ></div>

        <div
          className={`hud-group ${mobileSheetOpen ? 'mobile-sheet-open' : ''}`}
          id="hud-right"
        >
          <div
            className="mobile-sheet-handle-wrap"
            onClick={(e) => {
              e.stopPropagation();
              setMobileSheetOpen(false);
            }}
            aria-hidden="true"
          >
            <div className="mobile-sheet-handle"></div>
          </div>

          <div className="mobile-sheet-header">
            <span className="mobile-sheet-title">Controls</span>
            <button
              type="button"
              className="mobile-sheet-close"
              id="btn-mobile-sheet-close"
              onClick={(e) => {
                e.stopPropagation();
                setMobileSheetOpen(false);
              }}
              aria-label="Close Controls"
            >
              Close ✕
            </button>
          </div>

          <div className="mobile-sheet-section-label">Game Actions</div>

          <button
            type="button"
            className="hud-btn primary"
            id="btn-multiplayer"
            onClick={() => {
              setIsMultiplayerOpen(true);
              setMobileSheetOpen(false);
            }}
          >
            Multiplayer
          </button>
          <button
            className="hud-btn"
            id="btn-side-toggle"
            title="Switch between Playing as White and Playing as Black"
            onClick={() => setMobileSheetOpen(false)}
          >
            Play as Black
          </button>
          <button
            className="hud-btn"
            id="btn-ai-move"
            title="Let the AI make the next move immediately"
            onClick={() => setMobileSheetOpen(false)}
          >
            AI Move
          </button>
          <button
            className="hud-btn"
            id="btn-reset"
            title="Start a fresh game on the altar"
            onClick={() => setMobileSheetOpen(false)}
          >
            New Game
          </button>

          <div className="hud-divider" aria-hidden="true"></div>
          <div className="mobile-sheet-section-label">
            <span>Camera Views</span>
            <span className="mobile-sheet-section-sub">Tap active view to flip</span>
          </div>

          <button
            className="hud-btn active"
            id="btn-cam-player"
            title="Player Camera (Click again to flip White / Black view)"
          >
            Player Cam
          </button>
          <button
            className="hud-btn"
            id="btn-cam-top"
            title="Overhead Board View (Click again to flip White / Black orientation)"
          >
            Overhead
          </button>
          <button
            className="hud-btn"
            id="btn-cam-side"
            title="Side Profile View (Click again to switch East / West side)"
          >
            Side
          </button>
          <button
            className="hud-btn"
            id="btn-cam-wide"
            title="Wide Cathedral View (Click again to switch North Rose / South Narthex)"
          >
            Cathedral
          </button>

          <div className="hud-divider" aria-hidden="true"></div>
          <div className="mobile-sheet-section-label">Display &amp; Gestures</div>

          <button
            className="hud-btn"
            id="btn-hide-ui"
            title="Toggle HUD visibility (Shortcut: H)"
            onClick={() => setMobileSheetOpen(false)}
          >
            Hide UI [H]
          </button>

          <div className="mobile-sheet-hint">
            <strong>Touch:</strong> Tap Piece to Move &nbsp;•&nbsp; 1-Finger Drag: Orbit &nbsp;•&nbsp; 2-Finger Drag: Pan &nbsp;•&nbsp; Pinch: Zoom
          </div>
        </div>
      </div>

      <div id="hud-bottom">
        <div className="hint-pill" id="controls-hint">
          <strong>Controls:</strong> Click Piece to Move &nbsp;•&nbsp; Left-Drag: Orbit &nbsp;•&nbsp; Right-Drag: Pan &nbsp;•&nbsp; Scroll: Zoom &nbsp;•&nbsp; WASD + R/F: Fly Cam &nbsp;•&nbsp; H: Hide UI
        </div>

        {gameMode === 'multi' && roomData && (
          <div className="mp-dock-taunts">
            <button type="button" className="mp-dock-taunt-btn" onClick={() => handleSendChat('⚔️ En garde!')}>
              ⚔️ En garde!
            </button>
            <button type="button" className="mp-dock-taunt-btn" onClick={() => handleSendChat('✨ Well played!')}>
              ✨ Well played!
            </button>
            <button type="button" className="mp-dock-taunt-btn" onClick={() => handleSendChat('⚡ Check!')}>
              ⚡ Check!
            </button>
            <button type="button" className="mp-dock-taunt-btn" onClick={() => handleSendChat('👑 Rematch?')}>
              👑 Rematch?
            </button>
          </div>
        )}

        <div className="captured-pill" id="captured-tray"></div>
      </div>

      {/* Modern Gothic Multiplayer Modal */}
      {isMultiplayerOpen && (
        <div
          className="mp-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMultiplayerOpen(false);
          }}
        >
          <div className="mp-modal-container" id="multiplayer-modal" role="dialog" aria-modal="true">
            <div className="mp-modal-header">
              <div className="mp-modal-title">
                <span>Sanctum Chamber &amp; Multiplayer</span>
              </div>
              <button
                type="button"
                className="mp-modal-close"
                onClick={() => setIsMultiplayerOpen(false)}
                aria-label="Close Dialog"
              >
                ✕
              </button>
            </div>

            <div className="mp-tabs">
              <button
                type="button"
                className={`mp-tab-btn ${activeTab === 'online' ? 'active' : ''}`}
                onClick={() => setActiveTab('online')}
              >
                Online Duel
              </button>
              <button
                type="button"
                className={`mp-tab-btn ${activeTab === 'local' ? 'active' : ''}`}
                onClick={() => setActiveTab('local')}
              >
                Pass &amp; Play (2P)
              </button>
              <button
                type="button"
                className={`mp-tab-btn ${activeTab === 'single' ? 'active' : ''}`}
                onClick={() => setActiveTab('single')}
              >
                Single vs AI
              </button>
            </div>

            <div className="mp-modal-body">
              {activeTab === 'online' && (
                <>
                  {roomData ? (
                    <div className="mp-section">
                      <div className="mp-chamber-card">
                        <div className="mp-chamber-label">Active Sanctum Chamber</div>
                        <div className="mp-chamber-code">{roomData.code}</div>
                        <div className={`mp-status-badge ${bothPlayersConnected ? 'connected' : 'waiting'}`}>
                          {bothPlayersConnected
                            ? '● Both Wizards Connected — Duel in Progress'
                            : '⏳ Waiting for Opponent to Join...'}
                        </div>
                        <div className="mp-actions-row">
                          <button type="button" className="mp-btn-primary" onClick={handleCopyCode}>
                            Copy Code
                          </button>
                          <button type="button" className="mp-btn-secondary" onClick={handleCopyLink}>
                            Copy Invite Link
                          </button>
                          <button type="button" className="mp-btn-secondary" onClick={handleLeaveRoom}>
                            Leave Chamber
                          </button>
                        </div>
                      </div>

                      <div className="mp-section-title">Chamber Chat &amp; Wizard Taunts</div>
                      <div className="mp-chat-container">
                        <div className="mp-chat-messages">
                          {roomData.messages && roomData.messages.length > 0 ? (
                            roomData.messages.map((m) => (
                              <div key={m.id} className={`mp-chat-msg ${m.color}`}>
                                <span className="mp-chat-sender">{m.name}:</span>
                                <span>{m.text}</span>
                              </div>
                            ))
                          ) : (
                            <div className="mp-chat-msg system">No spells or words uttered yet in this chamber.</div>
                          )}
                        </div>

                        <div className="mp-input-group" style={{ marginBottom: 4 }}>
                          <input
                            type="text"
                            className="mp-input"
                            placeholder="Cast a wizard message..."
                            value={chatText}
                            onChange={(e) => setChatText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSendChat();
                            }}
                          />
                          <button type="button" className="mp-btn-primary" onClick={() => handleSendChat()}>
                            Send
                          </button>
                        </div>

                        <div className="mp-taunts-wrap">
                          <button type="button" className="mp-taunt-chip" onClick={() => handleSendChat('⚔️ En garde!')}>
                            ⚔️ En garde!
                          </button>
                          <button type="button" className="mp-taunt-chip" onClick={() => handleSendChat('✨ Well played!')}>
                            ✨ Well played!
                          </button>
                          <button type="button" className="mp-taunt-chip" onClick={() => handleSendChat('⚡ Check!')}>
                            ⚡ Check!
                          </button>
                          <button type="button" className="mp-taunt-chip" onClick={() => handleSendChat('👑 Rematch?')}>
                            👑 Rematch?
                          </button>
                          <button type="button" className="mp-taunt-chip" onClick={() => handleSendChat('🛡️ Good game!')}>
                            🛡️ Good game!
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mp-section">
                        <div className="mp-section-title">Your Wizard Title</div>
                        <input
                          type="text"
                          className="mp-input"
                          style={{ width: '100%', marginBottom: 14 }}
                          placeholder="Wizard name"
                          value={playerName}
                          onChange={(e) => setPlayerName(e.target.value)}
                          maxLength={24}
                        />

                        <div className="mp-section-title">Summon New Chamber (Host Game)</div>
                        <div className="mp-color-picker">
                          <div
                            className={`mp-color-card ${selectedColor === 'w' ? 'selected' : ''}`}
                            onClick={() => setSelectedColor('w')}
                          >
                            <span className="mp-color-icon">♔</span>
                            <span className="mp-color-label">Play White</span>
                          </div>
                          <div
                            className={`mp-color-card ${selectedColor === 'b' ? 'selected' : ''}`}
                            onClick={() => setSelectedColor('b')}
                          >
                            <span className="mp-color-icon">♚</span>
                            <span className="mp-color-label">Play Black</span>
                          </div>
                          <div
                            className={`mp-color-card ${selectedColor === 'random' ? 'selected' : ''}`}
                            onClick={() => setSelectedColor('random')}
                          >
                            <span className="mp-color-icon">🎲</span>
                            <span className="mp-color-label">Random</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="mp-btn-primary"
                          style={{ width: '100%', marginBottom: 18 }}
                          onClick={handleCreateRoom}
                          disabled={isCreating}
                        >
                          {isCreating ? 'Summoning...' : 'Summon Chamber & Create Duel'}
                        </button>

                        <div className="mp-section-title">Enter Existing Chamber (Join by Code)</div>
                        <div className="mp-input-group">
                          <input
                            type="text"
                            className="mp-input"
                            placeholder="Enter 4-8 character code (e.g. MAGE42)"
                            value={roomCodeInput}
                            onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleJoinRoom();
                            }}
                            maxLength={10}
                          />
                          <button
                            type="button"
                            className="mp-btn-primary"
                            onClick={() => handleJoinRoom()}
                            disabled={isJoining}
                          >
                            {isJoining ? 'Entering...' : 'Enter Sanctum'}
                          </button>
                        </div>
                      </div>

                      {publicRooms.length > 0 && (
                        <div className="mp-section">
                          <div className="mp-section-title">Open Sanctum Duels Waiting for Rivals</div>
                          <div className="mp-public-list">
                            {publicRooms.map((r) => (
                              <div key={r.code} className="mp-public-item">
                                <div className="mp-public-info">
                                  <span className="mp-public-code">{r.code}</span>
                                  <span className="mp-public-sub">
                                    {r.whiteJoined && !r.blackJoined
                                      ? 'White waiting for Black rival'
                                      : !r.whiteJoined && r.blackJoined
                                      ? 'Black waiting for White rival'
                                      : 'Chamber open'}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="mp-btn-primary"
                                  style={{ padding: '7px 14px', fontSize: '0.78rem' }}
                                  onClick={() => handleJoinRoom(r.code)}
                                >
                                  Join Duel
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {activeTab === 'local' && (
                <div className="mp-section">
                  <div className="mp-section-title">Pass &amp; Play on Same Screen</div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
                    Play face-to-face on this computer or tablet. Players take turns moving White and Black pieces directly on the obsidian altar.
                  </p>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 18,
                      fontSize: '0.84rem',
                      cursor: 'pointer',
                      color: 'var(--text)'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={autoFlipCamera}
                      onChange={(e) => setAutoFlipCamera(e.target.checked)}
                      style={{ width: 18, height: 18, accentColor: 'var(--gold)' }}
                    />
                    <span>Smoothly flip camera to active player's side after each turn</span>
                  </label>

                  <button
                    type="button"
                    className="mp-btn-primary"
                    style={{ width: '100%' }}
                    onClick={handleStartLocal2P}
                  >
                    Start Local 2-Player Match
                  </button>
                </div>
              )}

              {activeTab === 'single' && (
                <div className="mp-section">
                  <div className="mp-section-title">Single Player vs Gothic Cathedral AI</div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
                    Practice against the Sanctum Archmage. Experience sculpted piece animations, melee strikes, and stone shatter physics.
                  </p>

                  <div className="mp-color-picker">
                    <div
                      className={`mp-color-card ${selectedColor === 'w' ? 'selected' : ''}`}
                      onClick={() => setSelectedColor('w')}
                    >
                      <span className="mp-color-icon">♔</span>
                      <span className="mp-color-label">Play as White</span>
                    </div>
                    <div
                      className={`mp-color-card ${selectedColor === 'b' ? 'selected' : ''}`}
                      onClick={() => setSelectedColor('b')}
                    >
                      <span className="mp-color-icon">♚</span>
                      <span className="mp-color-label">Play as Black</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="mp-btn-primary"
                    style={{ width: '100%' }}
                    onClick={() => handleStartSinglePlayer(selectedColor === 'b' ? 'b' : 'w')}
                  >
                    Start Single Player Match
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div id="checkmate-overlay" role="status" aria-live="polite">
        <div className="checkmate-banner">
          <div className="checkmate-ornament">✦ &nbsp; Sanctum Judgment &nbsp; ✦</div>
          <div className="checkmate-crown" id="checkmate-crown">♔</div>
          <div className="checkmate-title" id="checkmate-title">Checkmate</div>
          <div className="checkmate-rule"></div>
          <div className="checkmate-subtitle" id="checkmate-subtitle">
            White Triumphs • The Black King Has Fallen
          </div>
          <div className="checkmate-actions">
            <button className="checkmate-btn" id="btn-checkmate-replay">
              Replay King Fall
            </button>
            <button className="checkmate-btn" id="btn-checkmate-newgame">
              New Game
            </button>
            <button className="checkmate-btn secondary" id="btn-checkmate-dismiss">
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

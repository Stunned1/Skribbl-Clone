import React, { useEffect, useRef, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import type { GameRoomData, Player, DrawStroke, ServerMessage, ChatMessage } from '../types/game';
import { Chat } from './Chat';
import { Scoreboard } from './Scoreboard';

interface GameRoomProps {
  room: GameRoomData;
  currentPlayer: Player;
  onLeaveRoom: () => void;
}

export const GameRoom: React.FC<GameRoomProps> = ({ room, currentPlayer, onLeaveRoom }) => {
  // Validate room data before using
  if (!room || !currentPlayer) {
    console.error('GameRoom: Missing room or player data');
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h2>Error: Missing game data</h2>
        <p>Please return to the lobby and try again.</p>
        <button onClick={onLeaveRoom} style={{ padding: '10px 20px', marginTop: '10px' }}>
          Return to Lobby
        </button>
      </div>
    );
  }

  // Game state
  const [wordOptions, setWordOptions] = useState<string[]>([]);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [wordSelectionTimeLeft, setWordSelectionTimeLeft] = useState(10);
  const [isWordSelectionPhase, setIsWordSelectionPhase] = useState(false);
  const [roundTimeLeft, setRoundTimeLeft] = useState(0);
  const [isDrawingPhase, setIsDrawingPhase] = useState(false);
  const [roundResults, setRoundResults] = useState<{ topGuesser?: string; artistPoints?: number; word?: string; entries?: Array<{ name: string; points: number }> } | null>(null);

  // Timer refs
  const wordSelectionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const roundTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Helper function to safely clear round timer
  const clearRoundTimer = () => {
    if (roundTimerRef.current) {
      console.log('Clearing round timer');
      clearInterval(roundTimerRef.current);
      roundTimerRef.current = null;
    }
  };

  // Word library
  const wordLibrary = [
    "Aatrox", "Ahri", "Akali", "Akshan", "Alistar", "Ambessa", "Amumu", "Anivia", "Annie", "Aphelios", "Ashe", "Aurelion Sol", "Aurora", "Azir", 
    "Bard", "Bel'Veth", "Blitzcrank", "Brand", "Braum", "Briar", 
    "Caitlyn", "Camille", "Cassiopeia", "Cho'Gath", "Corki", 
    "Darius", "Diana", "Dr. Mundo", "Draven", 
    "Ekko", "Elise", "Evelynn", "Ezreal", 
    "Fiddlesticks", "Fiora", "Fizz", 
    "Galio", "Gangplank", "Garen", "Gnar", "Gragas", "Graves", "Gwen", 
    "Hecarim", "Heimerdinger", "Hwei", 
    "Illaoi", "Irelia", "Ivern", 
    "Janna", "Jarvan IV", "Jax", "Jayce", "Jhin", "Jinx", 
    "K'Sante", "Kai'Sa", "Kalista", "Karma", "Karthus", "Kassadin", "Katarina", "Kayle", "Kayn", "Kennen", "Kha'Zix", "Kindred", "Kled", "Kog'Maw", 
    "LeBlanc", "Lee Sin", "Leona", "Lillia", "Lissandra", "Lucian", "Lulu", "Lux", 
    "Malphite", "Malzahar", "Maokai", "Master Yi", "Mel", "Milio", "Miss Fortune", "Mordekaiser", "Morgana", 
    "Naafiri", "Nami", "Nasus", "Nautilus", "Neeko", "Nidalee", "Nilah", "Nocturne", "Nunu & Willump", 
    "Olaf", "Orianna", "Ornn", 
    "Pantheon", "Poppy", "Pyke", 
    "Qiyana", "Quinn", 
    "Rakan", "Rammus", "Rek'Sai", "Rell", "Renata Glasc", "Renekton", "Rengar", "Riven", "Rumble", "Ryze", 
    "Samira", "Sejuani", "Senna", "Seraphine", "Sett", "Shaco", "Shen", "Shyvana", "Singed", "Sion", "Sivir", "Skarner", "Smolder", "Sona", "Soraka", "Swain", "Sylas", "Syndra", 
    "Tahm Kench", "Taliyah", "Talon", "Taric", "Teemo", "Thresh", "Tristana", "Trundle", "Tryndamere", "Twisted Fate", "Twitch", 
    "Udyr", "Urgot", 
    "Varus", "Vayne", "Veigar", "Vel'Koz", "Vex", "Vi", "Viego", "Viktor", "Vladimir", "Volibear", 
    "Warwick", "Wukong", 
    "Xayah", "Xerath", "Xin Zhao", 
    "Yasuo", "Yone", "Yorick", "Yunara", "Yuumi", "Zac", 
    "Zed", "Zeri", "Ziggs", "Zilean", "Zoe", "Zyra",
    "Voidgrubs", "Rift Herald", "Atakhan", "Baron Nashor",
    "Elder Dragon", "Cloud Drake", "Ocean Drake", "Mountain Drake", "Infernal Drake", "Hextech Drake", "Chemtech Drake", 
    "Gromp", "Krugs", "Raptors", "Murk Wolves",
    "Blast Cone", 
    "Melee Minion", "Caster Minion", 
    "Stealth Ward", "Control Ward", "Farsight Ward",
    "Refillable Potion", "Doran's Blade", "Doran's Ring", "Doran's Shield", 
    "Cull", "Boots", "Berserker's Greaves", "Sorcerer's Shoes", "Mercury's Treads", 
    "Plated Steelcaps", "Boots of Swiftness", "Long Sword", "Dagger", "B. F. Sword", 
    "Pickaxe", "Recurve Bow", "Cloak of Agility", "Vampiric Scepter", "Serrated Dirk", 
    "Tiamat", "Sheen", "Phage", "Lost Chapter", "Kindlegem", "Giant's Belt", 
    "Crystalline Bracer", "Chain Vest", "Cloth Armor", "Bramble Vest", "Spectre's Cowl", 
    "Infinity Edge", "Navori Quickblades", "Essence Reaver", "The Collector", "Lord Dominik's Regards", 
    "Mortal Reminder", "Bloodthirster", "Kraken Slayer", "Runaan's Hurricane", "Phantom Dancer", "Rapid Firecannon", 
    "Statikk Shiv", "Guinsoo's Rageblade", "Terminus", "Immortal Shieldbow", "Blade of the Ruined King", "Wit's End", "Youmuu's Ghostblade", 
    "Duskblade of Draktharr", "Voltaic Cyclosword", "Opportunity", "Hubris", "Profane Hydra", "Serpent's Fang", "Edge of Night", "Serylda's Grudge", 
    "Black Cleaver", "Death's Dance", "Sterak's Gage", "Titanic Hydra", "Ravenous Hydra", 
    "Spear of Shojin", "Hullbreaker", "Stridebreaker", "Goredrinker", "Trinity Force", 
    "Divine Sunderer", "Maw of Malmortius", "Guardian Angel", "Quicksilver Sash", 
    "Mercurial Scimitar", "Silvermere Dawn", "Luden's Companion", "Liandry's Torment", 
    "Rod of Ages", "Archangel's Staff", "Rabadon's Deathcap", "Void Staff", "Shadowflame", "Rylai's Crystal Scepter", 
    "Banshee's Veil", "Zhonya's Hourglass", "Morellonomicon", "Nashor's Tooth", "Cryptbloom", 
    "Stormsurge", "Malignance", "Cosmic Drive", "Horizon Focus", "Lich Bane", "Thornmail", 
    "Randuin's Omen", "Frozen Heart", "Dead Man's Plate", "Force of Nature", "Spirit Visage", "Abyssal Mask", "Warmog's Armor", 
    "Hollow Radiance", "Heartsteel", "Kaenic Rookern", "Unending Despair", "Iceborn Gauntlet", "Gargoyle Stoneplate", "Knight's Vow", 
    "Zeke's Convergence", "Winter's Approach", "Moonstone Renewer", "Locket of the Iron Solari", "Echoes of Helia", "Ardent Censer", "Staff of Flowing Water", 
    "Mikael's Blessing", "Redemption", "Vigilant Wardstone", "Chempunk Chainsword", "Oblivion Orb", "Executioner's Calling"
  ];

  // Generate 3 random words for selection
  const generateWordOptions = () => {
    const shuffled = [...wordLibrary].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 3);
  };

  // Start word selection phase
  const startWordSelection = () => {
    // Prevent starting word selection if already in progress or if not the drawer
    if (isWordSelectionPhase || !isDrawer) {
      console.log('Word selection already in progress or not drawer, skipping');
      return;
    }
    
    const options = generateWordOptions();
    setWordOptions(options);
    setIsWordSelectionPhase(true);
    setWordSelectionTimeLeft(10);
    
    // Start countdown timer
    wordSelectionTimerRef.current = setInterval(() => {
      setWordSelectionTimeLeft(prev => {
        if (prev <= 1) {
          // Time's up - auto-select first word (force bypass guards)
          selectWord(options[0], { force: true });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Handle word selection
  const selectWord = (word: string, opts?: { force?: boolean }) => {
    const force = Boolean(opts?.force);
    // Prevent multiple word selections unless forced (auto-select)
    if (!force && (selectedWord || !isWordSelectionPhase)) {
      console.log('Word already selected or not in word selection phase, ignoring');
      return;
    }
    
    console.log('Word selected:', word, force ? '(forced)' : '');
    setSelectedWord(word);
    setIsWordSelectionPhase(false);
    setIsDrawingPhase(true);
    setRoundTimeLeft(room.round_duration); // Use room's round duration setting
    
    // Clear word selection timer
    if (wordSelectionTimerRef.current) {
      clearInterval(wordSelectionTimerRef.current);
      wordSelectionTimerRef.current = null;
    }
    
    // CRITICAL: Clear any existing round timer before starting a new one
    clearRoundTimer();
    
    // Start round timer
    console.log('Starting round timer with duration:', room.round_duration);
    roundTimerRef.current = setInterval(() => {
      setRoundTimeLeft(prev => {
        if (prev <= 1) {
          // Round time's up
          endRound();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    // Send word selection to backend
    sendMessage({
      type: 'WordSelected',
      room_code: room.code,
      word
    } as any);
  };

  // End round (now handled by backend timer)
  const endRound = () => {
    console.log('Manual round end requested - this should not happen normally');
    setIsDrawingPhase(false);
    setSelectedWord(null);
    clearRoundTimer();
    clearCanvas();
  };

  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [systemMessages, setSystemMessages] = useState<ChatMessage[]>([]);

  const { isConnected, sendMessage } = useWebSocket({
    onMessage: (message: ServerMessage) => {
      if (!canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      // Handle word selection: winners receive the word; non-winners just start the timer
      if (message.type === 'WordSelected') {
        if (message.word) {
          setSelectedWord(message.word);
        }
        setIsDrawingPhase(true);
        setRoundTimeLeft(room.round_duration);
        
        // CRITICAL: Clear any existing round timer before starting a new one
        clearRoundTimer();
        
        // Start round timer for display only (backend handles actual round ending)
        console.log('Starting round timer display with duration:', room.round_duration);
        roundTimerRef.current = setInterval(() => {
          setRoundTimeLeft(prev => {
            if (prev <= 1) {
              // Timer display only - backend will end the round
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }

      // When next round starts (RoundStart), reset local state and clear canvas
      if (message.type === 'RoundStart') {
        console.log('RoundStart received, resetting game state');
        setIsDrawingPhase(false);
        setIsWordSelectionPhase(false);
        setSelectedWord(null);
        clearRoundTimer();
        clearCanvas();
        
        // Start word selection for the new drawer ONLY if we are the drawer
        if (room.current_drawer === currentPlayer.id) {
          console.log('We are the new drawer, starting word selection');
          // Small delay to ensure everything is ready
          const timer = setTimeout(() => {
            startWordSelection();
          }, 1000);
          return () => clearTimeout(timer);
        } else {
          console.log('We are not the drawer, waiting for word selection');
        }
      }

      // Handle chat messages
      if (message.type === 'ChatMessage' && message.message) {
        // Chat messages are handled by the backend state updates
        // The room.chat_messages will be updated via GameStateUpdate
        console.log('Chat message received:', message.message);
      }

      // Handle round scores (show brief results and stop current round locally)
      if (message.type === 'RoundScores' && message.scores) {
        const scores = message.scores;
        const guesserEntries = Object.entries(scores.guesser_scores || {});
        const top = guesserEntries.sort((a, b) => b[1] - a[1])[0];
        const topName = top ? room.players[top[0]]?.username : undefined;

        // Build per-player round points list (artist + guessers)
        const roundEntries: Array<{ name: string; points: number }> = [];
        // Artist first
        if (room.current_drawer) {
          const artist = room.players[room.current_drawer];
          if (artist) {
            roundEntries.push({ name: artist.username, points: scores.artist_score || 0 });
          }
        }
        // Guessers
        for (const [pid, pts] of Object.entries(scores.guesser_scores || {})) {
          const player = room.players[pid];
          if (player) {
            roundEntries.push({ name: player.username, points: pts as number });
          }
        }
        // Sort by points desc
        roundEntries.sort((a, b) => b.points - a.points);
        setIsDrawingPhase(false);
        setIsWordSelectionPhase(false);
        setSelectedWord(null);
        clearRoundTimer();
        setRoundResults({ topGuesser: topName, artistPoints: scores.artist_score, word: scores.word, entries: roundEntries });
        setTimeout(() => setRoundResults(null), 3000);
      }

      // Handle correct guesses
      if (message.type === 'CorrectGuess' && message.player) {
        const guessedPlayer = message.player as Player;
        console.log('Correct guess by:', guessedPlayer.username);
        // System chat message: X guessed the word!
        const sysMsg: ChatMessage = {
          id: `sys-${Date.now()}`,
          player_id: 'system',
          username: 'System',
          message: `${guessedPlayer.username} guessed the word!`,
          timestamp: new Date().toISOString(),
          is_winners_only: false,
        };
        setSystemMessages((prev) => [...prev, sysMsg]);
        // Highlight on scoreboard
        setHighlightedIds((prev) => new Set(prev).add(guessedPlayer.id));
        setTimeout(() => {
          setHighlightedIds((prev) => {
            const next = new Set(prev);
            next.delete(guessedPlayer.id);
            return next;
          });
          // Remove the system message after a short delay
          setSystemMessages((prev) => prev.filter(m => m.id !== sysMsg.id));
        }, 2500);
      }

      // Only draw strokes from the drawer if we are a watcher
      if (message.type === 'DrawStroke' && room.current_drawer !== currentPlayer.id) {
        const s = message.stroke;
        if (!s) return;

        // Check if this is a "pen up" signal (special coordinates)
        if (s.x === -1 && s.y === -1) {
          // Commit the accumulated watcher path once to avoid alpha compounding
          const serverColor = (message.stroke as any).color || (message.stroke as any).color_hex || '#000000';
          const serverSize = (message.stroke as any).brushPx ?? (message.stroke as any).brush_px ?? ((message.stroke as any).brush_size === 'Large' ? 8 : (message.stroke as any).brush_size === 'Small' ? 2 : 4);
          const serverAlpha = (message.stroke as any).alpha ?? 1;
          const serverEraser = Boolean((message.stroke as any).is_eraser);
          const main = canvasRef.current?.getContext('2d');
          const octx = overlayRef.current?.getContext('2d');
          if (octx && overlayRef.current) {
            octx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
          }
          if (!serverEraser && main && watcherPathRef.current.length >= 2) {
            drawPathOnce(main, watcherPathRef.current, serverColor, serverSize, serverAlpha, serverEraser);
          }
          watcherPathRef.current = [];
          lastPointRef.current = null;
          return;
        }

        const last = lastPointRef.current;
        // If pen was up (no last point), just start the path
        if (!last) {
          lastPointRef.current = { x: s.x, y: s.y };
          watcherPathRef.current = [{ x: s.x, y: s.y }];
          return;
        }
        // Accumulate and render depending on tool
        const serverColor = (s as any).color || (s as any).color_hex || '#000000';
        const serverSize = (s as any).brushPx ?? (s as any).brush_px ?? ((s as any).brush_size === 'Large' ? 8 : (s as any).brush_size === 'Small' ? 2 : 4);
        const serverAlpha = (s as any).alpha ?? 1;
        const serverEraser = Boolean((s as any).is_eraser);
        if (serverEraser) {
          // Apply eraser directly to main canvas for realtime effect
          drawSegment(ctx, last.x, last.y, s.x, s.y, serverColor, serverSize, serverAlpha, true);
        } else {
          watcherPathRef.current.push({ x: s.x, y: s.y });
          const octx = overlayRef.current?.getContext('2d');
          if (octx && overlayRef.current) {
            octx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
            drawPathOnce(octx, watcherPathRef.current, serverColor, serverSize, serverAlpha, false);
          }
        }
        lastPointRef.current = { x: s.x, y: s.y };
      }
    }
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const currentPathRef = useRef<Array<{ x: number; y: number }>>([]);
  const watcherPathRef = useRef<Array<{ x: number; y: number }>>([]);
  // Helper function to check if we are the current drawer
  const isCurrentDrawer = room.current_drawer === currentPlayer.id;
  
  // Update the isDrawer variable to use the more robust check
  const isDrawer = isCurrentDrawer;
  const [brushColor, setBrushColor] = useState<string>('#000000');
  const [brushSize, setBrushSize] = useState<number>(4);
  const [alpha, setAlpha] = useState<number>(1);
  const [isEraser, setIsEraser] = useState<boolean>(false);

  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
    const normalized = (hex || '').trim().replace(/^#/, '');
    if (!/^(\d|[a-fA-F]){6}$/.test(normalized)) return null;
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return { r, g, b };
  };
  const rgbToHex = ({ r, g, b }: { r: number; g: number; b: number }) => {
    const toHex = (x: number) => clamp(x | 0, 0, 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  };

  // Basic line draw helper
  const drawSegment = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color?: string, size?: number, a?: number, eraser?: boolean) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const prevComposite = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = typeof a === 'number' ? a : 1;
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = color || '#000000';
    ctx.lineWidth = size || 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.globalCompositeOperation = prevComposite;
    ctx.globalAlpha = prevAlpha;
  };

  // Draw an accumulated polyline once (prevents self-darkening with alpha)
  const drawPathOnce = (
    ctx: CanvasRenderingContext2D,
    points: Array<{ x: number; y: number }>,
    color?: string,
    size?: number,
    a?: number,
    eraser?: boolean,
  ) => {
    if (points.length < 2) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const prevComposite = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = typeof a === 'number' ? a : 1;
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = color || '#000000';
    ctx.lineWidth = size || 4;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = prevComposite;
    ctx.globalAlpha = prevAlpha;
  };

  // Clear canvas helper
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // Drawer: handle mouse input and send strokes live
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fixed size and crisp pixels (handled in a separate effect to avoid clearing on color change)

    const handleDown = (e: MouseEvent) => {
      // Block drawing until drawer and word has been selected
      if (!isDrawer || !isConnected || !selectedWord) return;
      isDrawingRef.current = true;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      lastPointRef.current = { x, y };
      currentPathRef.current = [{ x, y }];
    };

    const handleMove = (e: MouseEvent) => {
      if (!isDrawer || !isConnected || !isDrawingRef.current || !selectedWord) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const last = lastPointRef.current;
      if (last) {
        if (isEraser) {
          // Eraser should affect main canvas in realtime
          drawSegment(ctx, last.x, last.y, x, y, brushColor, brushSize, alpha, true);
        } else {
          currentPathRef.current.push({ x, y });
          const octx = overlayRef.current?.getContext('2d');
          if (octx && overlayRef.current) {
            octx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
            drawPathOnce(octx, currentPathRef.current, brushColor, brushSize, alpha, false);
          }
        }
      }

      // Send live stroke point
      const stroke: DrawStroke = { x, y, color: brushColor, brush_size: brushSize, alpha, is_eraser: isEraser };
      // Send as DrawStroke message for realtime
      window.requestAnimationFrame(() => {
        const payload = {
          type: 'DrawStroke',
          room_code: room.code,
          stroke
        } as any;
        sendMessage(payload);
      });

      lastPointRef.current = { x, y };
    };

    const handleUp = () => {
      if (!isDrawer || !selectedWord) return;
      isDrawingRef.current = false;
      lastPointRef.current = null;
      
      // Commit path for paint strokes (eraser was already applied live)
      const octx = overlayRef.current?.getContext('2d');
      if (!isEraser && currentPathRef.current.length >= 2) {
        drawPathOnce(ctx, currentPathRef.current, brushColor, brushSize, alpha, false);
      }
      if (octx && overlayRef.current) {
        octx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      }

      // Send a special "pen up" message to notify watchers
      const penUpStroke: DrawStroke = { x: -1, y: -1, color: brushColor, brush_size: brushSize, alpha, is_eraser: isEraser };
      window.requestAnimationFrame(() => {
        const payload = {
          type: 'DrawStroke',
          room_code: room.code,
          stroke: penUpStroke
        } as any;
        sendMessage(payload);
      });
      currentPathRef.current = [];
    };

    canvas.addEventListener('mousedown', handleDown);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      canvas.removeEventListener('mousedown', handleDown);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDrawer, isConnected, room.code, selectedWord, brushColor, brushSize, alpha, isEraser]);

  // Watcher: ensure canvas base size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 800;
    canvas.height = 600;
    canvas.style.width = '800px';
    canvas.style.height = '600px';
    if (overlayRef.current) {
      overlayRef.current.width = 800;
      overlayRef.current.height = 600;
      overlayRef.current.style.width = '800px';
      overlayRef.current.style.height = '600px';
    }
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (wordSelectionTimerRef.current) {
        clearInterval(wordSelectionTimerRef.current);
      }
      clearRoundTimer();
    };
  }, []);

  // Auto-start word selection if player is drawer and game is ready
  useEffect(() => {
    // Only start word selection if:
    // 1. We are the current drawer
    // 2. Game is in playing state
    // 3. Not already in word selection phase
    // 4. Not already in drawing phase
    // 5. No word has been selected yet
    // 6. We are actually the current drawer (double-check)
    if (isDrawer && 
        room.game_state === 'Playing' && 
        !isWordSelectionPhase && 
        !isDrawingPhase && 
        !selectedWord &&
        room.current_drawer === currentPlayer.id) {
      console.log('Auto-starting word selection for current drawer');
      // Small delay to ensure everything is ready
      const timer = setTimeout(() => {
        startWordSelection();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isDrawer, room.game_state, isWordSelectionPhase, isDrawingPhase, selectedWord, room.current_drawer, currentPlayer.id]);

  const handleSendMessage = (message: string) => {
    sendMessage({
      type: 'Chat',
      room_code: room.code,
      message: message
    });
  };

  const handleSendWinnersMessage = (message: string) => {
    // For now, send as regular chat - backend will handle winners logic
    sendMessage({
      type: 'Chat',
      room_code: room.code,
      message: message
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 12, gap: 16 }}>
      {/* Game Status Bar */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        width: '800px', 
        padding: '8px 16px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        border: '1px solid #dee2e6'
      }}>
        <div style={{ fontWeight: 'bold', color: '#495057' }}>
          {isDrawer ? 'You are drawing!' : 'You are guessing!'}
        </div>
        {/* Artist word and round counter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {isDrawer && selectedWord && (
            <div style={{ 
              color: '#0f172a',
              fontWeight: 700,
              fontSize: '16px'
            }}>
              Word: {selectedWord}
            </div>
          )}
          <div style={{ color: '#475569', fontWeight: 600 }}>
            Cycle {room.cycle_number ?? 1}{room.max_rounds ? ` / ${room.max_rounds}` : ''} • Round {room.round_number ?? 1}
          </div>
        </div>

        {/* Word Display for Watchers */}
        {!isDrawer && selectedWord && (
          <div style={{ 
            color: '#6f42c1',
            fontWeight: 'bold',
            fontSize: '18px',
            letterSpacing: '2px'
          }}>
            {selectedWord.split('').map(() => '_').join(' ')}
          </div>
        )}
        
        {/* Timer Display */}
        {isWordSelectionPhase && isDrawer && (
          <div style={{ 
            color: wordSelectionTimeLeft <= 3 ? '#dc3545' : '#28a745',
            fontWeight: 'bold',
            fontSize: '18px'
          }}>
            Choose word: {wordSelectionTimeLeft}s
          </div>
        )}
        
        {isDrawingPhase && (
          <div style={{ 
            color: roundTimeLeft <= 30 ? '#dc3545' : '#28a745',
            fontWeight: 'bold',
            fontSize: '18px'
          }}>
            Time left: {Math.floor(roundTimeLeft / 60)}:{(roundTimeLeft % 60).toString().padStart(2, '0')}
          </div>
        )}
      </div>

      {/* Word Selection Phase - Floating over canvas */}
      {isWordSelectionPhase && isDrawer && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          display: 'flex',
          gap: '20px',
          justifyContent: 'center'
        }}>
          {wordOptions.map((word, index) => (
            <button
              key={index}
              onClick={() => selectWord(word)}
              style={{
                padding: '16px 32px',
                fontSize: '24px',
                fontWeight: 'bold',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                minWidth: '140px',
                boxShadow: '0 8px 24px rgba(0,123,255,0.3)',
                textShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#0056b3';
                e.currentTarget.style.transform = 'scale(1.1)';
                e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,123,255,0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#007bff';
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,123,255,0.3)';
              }}
            >
              {word}
            </button>
          ))}
        </div>
      )}

      {/* Drawing Phase - Show Selected Word */}
      {isDrawingPhase && isDrawer && selectedWord && (
        <div style={{
          backgroundColor: '#28a745',
          color: 'white',
          padding: '8px 16px',
          borderRadius: '20px',
          fontWeight: 'bold',
          fontSize: '16px'
        }}>
          Drawing: {selectedWord}
        </div>
      )}

      {/* Main area: left scoreboard, center canvas, right chat */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Left: Scoreboard */}
        <Scoreboard
          players={room.players}
          currentDrawerId={room.current_drawer}
          highlightIds={highlightedIds}
          artistStreak={room.players[room.current_drawer || ''] ? (room.players[room.current_drawer || ''] as any).artist_streak : 0}
        />

        {/* Center: Canvas */}
        <div style={{ position: 'relative' }}>
          {/* Tools for the artist only */}
          {isDrawer && isDrawingPhase && (
            <div style={{ position: 'absolute', top: -48, left: 0, display: 'flex', gap: 12, alignItems: 'center', background: '#f8fafc', padding: 6, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              {/* Minimal inline picker (Hex and RGB inputs) */}
              <div style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #e2e8f0', background: brushColor }} />
              <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} style={{ width: 36, height: 24, padding: 0, border: 'none', background: 'transparent' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#475569', fontSize: 12 }}>Hex</span>
                <input value={brushColor} onChange={(e) => setBrushColor(e.target.value)} style={{ width: 88, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#475569', fontSize: 12 }}>R</span>
                <input value={hexToRgb(brushColor)?.r ?? 0} onChange={(e) => {
                  const rgb = hexToRgb(brushColor) || { r: 0, g: 0, b: 0 };
                  const next = { ...rgb, r: Number(e.target.value.replace(/[^\d]/g, '')) };
                  setBrushColor(rgbToHex(next));
                }} style={{ width: 48, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6 }} inputMode="numeric" />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#475569', fontSize: 12 }}>G</span>
                <input value={hexToRgb(brushColor)?.g ?? 0} onChange={(e) => {
                  const rgb = hexToRgb(brushColor) || { r: 0, g: 0, b: 0 };
                  const next = { ...rgb, g: Number(e.target.value.replace(/[^\d]/g, '')) };
                  setBrushColor(rgbToHex(next));
                }} style={{ width: 48, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6 }} inputMode="numeric" />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#475569', fontSize: 12 }}>B</span>
                <input value={hexToRgb(brushColor)?.b ?? 0} onChange={(e) => {
                  const rgb = hexToRgb(brushColor) || { r: 0, g: 0, b: 0 };
                  const next = { ...rgb, b: Number(e.target.value.replace(/[^\d]/g, '')) };
                  setBrushColor(rgbToHex(next));
                }} style={{ width: 48, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 6 }} inputMode="numeric" />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                <span style={{ color: '#475569', fontSize: 12 }}>Opacity</span>
                <input type="range" min={0} max={1} step={0.05} value={alpha} onChange={(e) => setAlpha(parseFloat(e.target.value))} />
                <span style={{ color: '#334155', fontSize: 12 }}>{Math.round(alpha * 100)}%</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                <input type="checkbox" checked={isEraser} onChange={(e) => setIsEraser(e.target.checked)} />
                <span style={{ color: '#475569', fontSize: 12 }}>Eraser</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                <span style={{ color: '#475569', fontSize: 12 }}>Brush</span>
                <input
                  type="range"
                  min={1}
                  max={32}
                  step={1}
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value, 10))}
                />
                {/* Visual indicator: circle reflecting current size and opacity */}
                <div style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff' }}>
                  <div style={{ width: Math.max(4, brushSize), height: Math.max(4, brushSize), borderRadius: 9999, background: isEraser ? '#000' : brushColor, opacity: isEraser ? 1 : alpha, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)' }} />
                </div>
              </div>
            </div>
          )}
          {/* Round Results overlay */}
          {roundResults && (
            <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 10px', zIndex: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>Round Results</div>
              {roundResults.word && (
                <div style={{ color: '#334155' }}>Word: {roundResults.word}</div>
              )}
              {!!roundResults.artistPoints && (
                <div style={{ color: '#334155' }}>Artist: +{roundResults.artistPoints}</div>
              )}
              {roundResults.topGuesser && (
                <div style={{ color: '#16a34a' }}>Top guesser: {roundResults.topGuesser}</div>
              )}
              {roundResults.entries && roundResults.entries.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>Points this round</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {roundResults.entries.map((e, idx) => (
                      <div key={`${e.name}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', color: '#334155' }}>
                        <span>{e.name}</span>
                        <span>+{e.points}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div style={{ position: 'relative', width: 800, height: 600, background: '#fff', border: '2px solid #000', borderRadius: '8px' }}>
            <canvas 
              ref={canvasRef} 
              style={{ 
                position: 'absolute',
                left: 0,
                top: 0,
                zIndex: 0,
              }} 
            />
            <canvas
              ref={overlayRef}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                pointerEvents: 'none',
                zIndex: 1,
              }}
            />
          </div>
        </div>

        {/* Right: Chat */}
        <div style={{ width: 320, height: 300 }}>
          <Chat
            messages={[...room.chat_messages, ...systemMessages]}
            onSendMessage={handleSendMessage}
            onSendWinnersMessage={handleSendWinnersMessage}
            isWinner={(room.winners || []).includes(currentPlayer.id)}
            isArtist={room.current_drawer === currentPlayer.id}
            disabled={!isConnected}
          />
        </div>
      </div>

      {/* No global toasts; system messages injected into Chat */}
    </div>
  );
};


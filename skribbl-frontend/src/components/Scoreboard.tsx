import React from 'react';
import type { Player } from '../types/game';

interface ScoreboardProps {
  players: Record<string, Player>;
  currentDrawerId: string | null;
  highlightIds: Set<string>;
  artistStreak: number;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({ players, currentDrawerId, highlightIds, artistStreak }) => {
  const playerList = Object.values(players).sort((a, b) => b.score - a.score);

  const streakBonus = artistStreak > 0 ? artistStreak * 50 : 0;

  return (
    <div className="w-60 bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
      <div className="px-4 py-2 border-b bg-gray-50 font-semibold text-gray-800">Scoreboard</div>
      <div className="divide-y divide-gray-100">
        {playerList.map((p) => {
          const isDrawer = currentDrawerId === p.id;
          const isHighlighted = highlightIds.has(p.id);
          const rowBg = isDrawer ? 'bg-blue-100' : 'bg-white';
          const nameClass = isHighlighted ? 'text-green-700 font-semibold' : 'text-gray-800';
          const showStreak = isDrawer && artistStreak > 0;

          return (
            <div key={p.id} className={`px-3 py-2 ${rowBg} flex items-center justify-between`}>
              <div className="flex items-center gap-2 min-w-0">
                {/* Streak (artist only) */}
                {showStreak && (
                  <span className="text-green-700 text-xs bg-green-100 px-2 py-0.5 rounded-full shrink-0">+{streakBonus}</span>
                )}
                {/* Name */}
                <span className={`truncate ${nameClass}`}>{p.username}</span>
              </div>
              {/* Score */}
              <span className="text-gray-700 font-semibold shrink-0">{p.score}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};



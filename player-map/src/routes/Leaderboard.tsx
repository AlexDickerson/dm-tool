// Aurus leaderboard view for players. Subscribes to the sidecar's aurus
// stream via WebSocket; the DM's edits land here live. The player party is
// highlighted and pinned to the top of the ranked list.

import { useMemo } from 'react';
import { useLiveStream } from '../lib/live';
import type { AurusTeam } from '@shared/types';

interface AurusSnapshot {
  teams: AurusTeam[];
  updatedAt: string;
}

function cpToGp(cp: number): string {
  return (cp / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function scoreOf(team: AurusTeam): number {
  // Combat power (raw) plus value-reclaimed in gp. Same formula as the DM
  // leaderboard view — any change there must be mirrored here.
  return team.combatPower + team.valueReclaimedCp / 100;
}

export function Leaderboard() {
  const { data, status, lastUpdated } = useLiveStream<AurusSnapshot>('/api/aurus/stream');

  const ranked = useMemo(() => {
    return [...(data?.teams ?? [])].sort((a, b) => scoreOf(b) - scoreOf(a));
  }, [data]);

  const playerParty = ranked.find((t) => t.isPlayerParty);
  const playerRank = playerParty ? ranked.indexOf(playerParty) + 1 : null;

  const stale = status === 'disconnected' || (lastUpdated !== null && Date.now() - lastUpdated > 60_000);

  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'auto', color: '#e5e5e5', padding: '24px 32px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>Aurus Standings</h1>
            {playerParty && playerRank !== null && (
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9a9a9a' }}>
                {playerParty.name}: rank #{playerRank} of {ranked.length}
              </p>
            )}
          </div>
          <ConnectionIndicator status={status} stale={stale} />
        </header>

        {!data ? (
          <p style={{ color: '#9a9a9a', fontSize: 14 }}>Connecting…</p>
        ) : ranked.length === 0 ? (
          <p style={{ color: '#9a9a9a', fontSize: 14 }}>No teams have been registered yet.</p>
        ) : (
          <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {ranked.map((team, idx) => (
              <li
                key={team.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '50px 1fr auto',
                  gap: 16,
                  alignItems: 'center',
                  padding: '14px 18px',
                  marginBottom: 8,
                  borderRadius: 8,
                  backgroundColor: team.isPlayerParty ? 'rgba(228, 165, 71, 0.12)' : '#1a1a1a',
                  border: team.isPlayerParty ? '1px solid rgba(228, 165, 71, 0.4)' : '1px solid #2a2a2a',
                }}
              >
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: idx < 3 ? '#e4a547' : '#6a6a6a',
                    textAlign: 'center',
                  }}
                >
                  #{idx + 1}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        backgroundColor: team.color,
                      }}
                    />
                    <span style={{ fontSize: 17, fontWeight: 500 }}>{team.name}</span>
                    {team.isPlayerParty && (
                      <span
                        style={{
                          fontSize: 10,
                          textTransform: 'uppercase',
                          letterSpacing: '0.1em',
                          backgroundColor: 'rgba(228, 165, 71, 0.2)',
                          color: '#e4a547',
                          padding: '2px 6px',
                          borderRadius: 3,
                        }}
                      >
                        Your party
                      </span>
                    )}
                  </div>
                  {team.note && (
                    <div style={{ fontSize: 12, color: '#8a8a8a', marginTop: 4, fontStyle: 'italic' }}>{team.note}</div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 600, color: '#e5e5e5' }}>
                    {team.combatPower.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: '#9a9a9a' }}>Combat</div>
                  <div style={{ fontSize: 13, color: '#9a9a9a', marginTop: 4 }}>{cpToGp(team.valueReclaimedCp)} gp</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function ConnectionIndicator({ status, stale }: { status: string; stale: boolean }) {
  const color = status === 'connected' ? (stale ? '#d19a3a' : '#4ade80') : '#ef4444';
  const label = status === 'connected' ? (stale ? 'Stale' : 'Live') : status === 'connecting' ? 'Connecting…' : 'Offline';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9a9a9a' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, display: 'inline-block' }} />
      {label}
    </div>
  );
}

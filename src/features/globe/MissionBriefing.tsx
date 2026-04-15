// In-universe "parchment" view of a mission briefing, shown when the user
// double-clicks a mission pin on the globe. Data is parsed from the pin's
// Obsidian note frontmatter + body.
//
// Derived from a v0-generated mission-parchment component. Adapted to the
// dm-tool codebase: `@/lib/utils` import path, type imports from shared/types.

import type { MissionData, MissionThreatLevel } from '@shared/types';
import { cn } from '@/lib/utils';

// Threat level descriptions for in-universe feel
const threatDescriptions: Record<MissionThreatLevel, string> = {
  Trivial: 'Minor Concern',
  Low: 'Moderate Risk',
  Moderate: 'Significant Danger',
  Severe: 'Grave Peril',
  Extreme: 'Mortal Danger',
};

function toRoman(num: number): string {
  const romans: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let result = '';
  for (const [value, symbol] of romans) {
    while (num >= value) {
      result += symbol;
      num -= value;
    }
  }
  return result;
}

function WaxSeal({ className }: { className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: 64,
          height: 64,
          background: '#7a2020',
          boxShadow:
            'inset 0 2px 4px rgba(0,0,0,0.4), inset 0 -1px 2px rgba(255,200,200,0.1), 2px 3px 6px rgba(0,0,0,0.3)',
        }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            opacity: 0.3,
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          }}
        />
        <div className="relative text-xl" style={{ color: 'rgba(252, 211, 77, 0.6)' }}>
          &#9876;
        </div>
      </div>
    </div>
  );
}

function WavyDivider() {
  return (
    <svg
      className="my-6 w-full"
      style={{ height: 16, opacity: 0.25 }}
      viewBox="0 0 300 16"
      preserveAspectRatio="none"
    >
      <path
        d="M0,8 Q25,5 50,8 T100,8 T150,8 T200,8 T250,8 T300,8"
        fill="none"
        stroke="#5c4020"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 4"
      />
    </svg>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 text-center">
      <h2 className="mb-2 text-xs uppercase" style={{ color: '#5c4530', opacity: 0.7, letterSpacing: '0.25em' }}>
        {children}
      </h2>
      <div
        className="mx-auto"
        style={{
          width: 96,
          height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(139,115,85,0.5), transparent)',
        }}
      />
    </div>
  );
}

export interface MissionBriefingProps {
  mission: MissionData;
  onClose: () => void;
  onRefresh?: () => void | Promise<void>;
  onLinkNote?: () => void | Promise<void>;
  refreshing?: boolean;
  linking?: boolean;
}

export function MissionBriefing({
  mission,
  onClose,
  onRefresh,
  onLinkNote,
  refreshing = false,
  linking = false,
}: MissionBriefingProps) {
  const primaryObjectives = mission.objectives.filter((o) => o.isPrimary);
  const secondaryObjectives = mission.objectives.filter((o) => !o.isPrimary);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div className="mx-auto w-full max-w-3xl p-8" onClick={(e) => e.stopPropagation()}>
        {/* Toolbar */}
        <div className="mb-3 flex justify-end gap-2">
          {onLinkNote && (
            <button
              type="button"
              onClick={() => void onLinkNote()}
              disabled={linking}
              className="rounded-md border border-white/20 bg-white/10 px-3 py-1 text-xs uppercase text-white/80 hover:bg-white/20 disabled:opacity-50"
              style={{ letterSpacing: '0.1em' }}
              title="Associate this pin with an existing Obsidian note"
            >
              {linking ? 'Linking…' : 'Link Note'}
            </button>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              className="rounded-md border border-white/20 bg-white/10 px-3 py-1 text-xs uppercase text-white/80 hover:bg-white/20 disabled:opacity-50"
              style={{ letterSpacing: '0.1em' }}
              title="Re-parse the Obsidian note"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/20 bg-white/10 px-3 py-1 text-xs uppercase text-white/80 hover:bg-white/20"
            style={{ letterSpacing: '0.1em' }}
          >
            Close
          </button>
        </div>

        {/* Main parchment */}
        <article
          className="relative overflow-hidden"
          style={{
            fontFamily: "'Crimson Pro', 'Georgia', serif",
            backgroundColor: '#e8dcc8',
            boxShadow: '4px 6px 20px rgba(0,0,0,0.25), 2px 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          {/* Paper grain texture */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='grain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23grain)'/%3E%3C/svg%3E")`,
              opacity: 0.15,
              mixBlendMode: 'multiply',
            }}
          />

          {/* Aging/foxing spots */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `
                radial-gradient(ellipse 30% 20% at 15% 25%, rgba(120,80,40,0.08) 0%, transparent 70%),
                radial-gradient(ellipse 25% 35% at 80% 70%, rgba(100,70,30,0.06) 0%, transparent 60%),
                radial-gradient(ellipse 40% 25% at 60% 15%, rgba(110,75,35,0.05) 0%, transparent 50%),
                radial-gradient(ellipse 20% 30% at 25% 85%, rgba(90,60,25,0.07) 0%, transparent 60%)
              `,
            }}
          />

          {/* Edge vignette */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              boxShadow: 'inset 0 0 60px rgba(80,50,20,0.12), inset 0 0 120px rgba(60,40,15,0.08)',
            }}
          />

          {/* Fold lines */}
          <div
            className="pointer-events-none absolute left-0 right-0"
            style={{
              top: '33%',
              height: 1,
              background: 'linear-gradient(90deg, transparent 5%, rgba(80,50,20,0.08) 50%, transparent 95%)',
            }}
          />
          <div
            className="pointer-events-none absolute left-0 right-0"
            style={{
              top: '66%',
              height: 1,
              background: 'linear-gradient(90deg, transparent 5%, rgba(80,50,20,0.06) 50%, transparent 95%)',
            }}
          />

          {/* Content */}
          <div className="relative" style={{ padding: '40px 48px' }}>
            {/* Header */}
            <header className="mb-8 text-center">
              <p
                className="mb-4 text-[10px] uppercase"
                style={{ color: '#6b5a45', opacity: 0.6, letterSpacing: '0.4em' }}
              >
                Mission Briefing
              </p>
              <h1 className="mb-3 text-2xl font-semibold tracking-wide" style={{ color: '#3d2e1f' }}>
                {mission.name}
              </h1>

              {/* Hand-drawn underline */}
              <svg className="mx-auto mb-4" style={{ width: 192, height: 8, opacity: 0.35 }} viewBox="0 0 200 8">
                <path
                  d="M10,5 Q30,3 50,5 T90,4 T130,5 T170,4 T190,5"
                  fill="none"
                  stroke="#5c4020"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>

              <p className="text-sm italic" style={{ color: '#5a4a3a' }}>
                Threat Assessment:{' '}
                <span className="font-semibold not-italic" style={{ color: '#4a3525' }}>
                  {threatDescriptions[mission.threatLevel]}
                </span>
              </p>
            </header>

            {/* Mission details box */}
            <div
              className="relative mb-8 p-4"
              style={{
                backgroundColor: 'rgba(100,70,40,0.04)',
                borderLeft: '2px solid rgba(100,70,40,0.15)',
              }}
            >
              <div className="grid grid-cols-2 gap-4 text-sm">
                {mission.recommendedLevel && (
                  <div>
                    <span
                      className="mb-1 block text-[10px] uppercase"
                      style={{ color: '#7a6a55', opacity: 0.7, letterSpacing: '0.05em' }}
                    >
                      Experience Required
                    </span>
                    <span className="italic" style={{ color: '#4a3a2a' }}>
                      Adventurers of the {mission.recommendedLevel}th circle
                    </span>
                  </div>
                )}
                {mission.location && (
                  <div>
                    <span
                      className="mb-1 block text-[10px] uppercase"
                      style={{ color: '#7a6a55', opacity: 0.7, letterSpacing: '0.05em' }}
                    >
                      Theatre of Operations
                    </span>
                    <span className="italic" style={{ color: '#4a3a2a' }}>
                      {mission.location}
                    </span>
                  </div>
                )}
                {mission.questGiver.name && (
                  <div className="col-span-2">
                    <span
                      className="mb-1 block text-[10px] uppercase"
                      style={{ color: '#7a6a55', opacity: 0.7, letterSpacing: '0.05em' }}
                    >
                      Commissioned By
                    </span>
                    <span style={{ color: '#4a3a2a' }}>
                      <span className="italic">{mission.questGiver.name}</span>
                      {mission.questGiver.title && (
                        <span style={{ opacity: 0.7 }}>, {mission.questGiver.title}</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Briefing */}
            {mission.briefing.length > 0 && (
              <section className="mb-8">
                <SectionHeader>The Situation</SectionHeader>
                <div className="space-y-4 leading-relaxed" style={{ color: '#3a2e22', fontSize: 15 }}>
                  {mission.briefing.map((paragraph, index) => (
                    <p
                      key={index}
                      className="first-letter:float-left first-letter:mr-1 first-letter:text-2xl first-letter:font-bold first-letter:leading-none"
                      style={{ textIndent: index === 0 ? '0' : '1.5em' }}
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            )}

            <WavyDivider />

            {/* Objectives */}
            {mission.objectives.length > 0 && (
              <>
                <section className="mb-8">
                  <SectionHeader>Your Orders</SectionHeader>

                  {primaryObjectives.length > 0 && (
                    <div className="mb-5">
                      <h3
                        className="mb-3 text-center text-[10px] uppercase"
                        style={{ color: '#6b5a45', opacity: 0.6, letterSpacing: '0.05em' }}
                      >
                        Mandated Directives
                      </h3>
                      <ol className="space-y-2" style={{ color: '#3a2e22' }}>
                        {primaryObjectives.map((obj, index) => (
                          <li key={obj.id} className="flex gap-3 leading-relaxed" style={{ fontSize: 15 }}>
                            <span
                              className="shrink-0 text-right font-semibold"
                              style={{ width: 32, color: '#5a4a35' }}
                            >
                              {toRoman(index + 1)}.
                            </span>
                            <span>{obj.text}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {secondaryObjectives.length > 0 && (
                    <div className="mt-5 pt-4" style={{ borderTop: '1px solid rgba(100,70,40,0.12)' }}>
                      <h3
                        className="mb-3 text-center text-[10px] uppercase"
                        style={{ color: '#6b5a45', opacity: 0.6, letterSpacing: '0.05em' }}
                      >
                        Supplementary Tasks
                      </h3>
                      <ul className="space-y-2" style={{ color: '#4a3e30', opacity: 0.85, fontSize: 15 }}>
                        {secondaryObjectives.map((obj) => (
                          <li key={obj.id} className="flex gap-3 pl-8 italic">
                            <span style={{ opacity: 0.5 }}>—</span>
                            <span>{obj.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>

                <WavyDivider />
              </>
            )}

            {/* Known Threats */}
            {mission.threats.length > 0 && (
              <>
                <section className="mb-8">
                  <SectionHeader>Intelligence Report</SectionHeader>
                  <p
                    className="mb-4 text-center text-sm italic"
                    style={{ color: '#5a4a3a', opacity: 0.7 }}
                  >
                    Our scouts have confirmed the following hostile presences:
                  </p>
                  <ul className="space-y-1" style={{ color: '#3a2e22', fontSize: 15 }}>
                    {mission.threats.map((threat) => (
                      <li key={threat.id} className="flex items-baseline justify-between px-4">
                        <span>
                          {threat.name}
                          {threat.type && (
                            <span className="text-sm italic" style={{ opacity: 0.6 }}>
                              {' '}
                              ({threat.type})
                            </span>
                          )}
                        </span>
                        <span className="text-sm" style={{ color: '#5a4a35', opacity: 0.7 }}>
                          Level {threat.level}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>

                <WavyDivider />
              </>
            )}

            {/* Rewards */}
            {(mission.rewards.gold || (mission.rewards.items && mission.rewards.items.length > 0)) && (
              <section className="mb-8">
                <SectionHeader>Compensation Upon Completion</SectionHeader>
                <div className="space-y-2 text-center" style={{ color: '#3a2e22', fontSize: 15 }}>
                  {mission.rewards.gold && (
                    <p>
                      <span style={{ opacity: 0.6 }}>Treasury Allocation:</span>{' '}
                      <span className="font-semibold">
                        {mission.rewards.gold.toLocaleString()} gold pieces
                      </span>
                    </p>
                  )}
                  {mission.rewards.items && mission.rewards.items.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-2" style={{ opacity: 0.6 }}>
                        Additional Provisions:
                      </p>
                      <ul className="space-y-1 italic">
                        {mission.rewards.items.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Footer */}
            <footer className="mt-10 flex items-end justify-between pt-6">
              <div className="text-sm italic" style={{ color: '#5a4a3a', opacity: 0.7 }}>
                {mission.datePosted && <p>Posted this {mission.datePosted}</p>}
                {mission.sourceBook && <p className="mt-1">{mission.sourceBook}</p>}
              </div>

              <div className="flex flex-col items-center">
                <WaxSeal />
                <p
                  className="mt-2 text-[10px] uppercase"
                  style={{ color: '#6b5a45', opacity: 0.5, letterSpacing: '0.05em' }}
                >
                  Official Seal
                </p>
              </div>
            </footer>
          </div>
        </article>
      </div>
    </div>
  );
}

import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/globe', label: 'Globe' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/leaderboard', label: 'Aurus' },
];

export function Nav() {
  return (
    <nav
      style={{
        display: 'flex',
        flexShrink: 0,
        backgroundColor: '#1a1a1a',
        borderBottom: '1px solid #2d2d2d',
      }}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          style={({ isActive }) => ({
            padding: '12px 20px',
            color: isActive ? '#ffffff' : '#9a9a9a',
            textDecoration: 'none',
            borderBottom: isActive ? '2px solid #e4a547' : '2px solid transparent',
            fontSize: 14,
            fontWeight: 500,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            letterSpacing: '0.02em',
            transition: 'color 0.15s, border-color 0.15s',
          })}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

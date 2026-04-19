import { Outlet } from 'react-router-dom';
import { Nav } from './Nav';

export function Layout() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        backgroundColor: '#0f0f0f',
      }}
    >
      <Nav />
      <main style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <Outlet />
      </main>
    </div>
  );
}

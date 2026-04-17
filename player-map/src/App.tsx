// Router root for the player portal. Three routes: Globe (the Golarion
// world map with mission pins), Inventory (shared party loot), and
// Leaderboard (Aurus team standings). All share a top nav.

import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Globe } from './routes/Globe';
import { Inventory } from './routes/Inventory';
import { Leaderboard } from './routes/Leaderboard';

const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, element: <Navigate to="/globe" replace /> },
      { path: 'globe', Component: Globe },
      { path: 'inventory', Component: Inventory },
      { path: 'leaderboard', Component: Leaderboard },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}

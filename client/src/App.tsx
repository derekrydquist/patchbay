import { Switch, Route, Redirect, useLocation } from "wouter";
import Dashboard from "./pages/Dashboard";
import SongHome from "./pages/SongHome";
import Workspace from "./pages/Workspace";
import Login from "./pages/Login";
import NotFound from "./pages/not-found";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "./contexts/AuthContext";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) return null;
  if (!user && location !== "/login") return <Redirect to="/login" />;
  return <>{children}</>;
}

function Router() {
  const { user, isLoading } = useAuth();

  return (
    <Switch>
      <Route path="/login">
        {/* Redirect already-authenticated users away from the login page */}
        {!isLoading && user ? <Redirect to="/" /> : <Login />}
      </Route>
      <Route path="/">
        <RequireAuth><Dashboard /></RequireAuth>
      </Route>
      <Route path="/songs/:songId/workspace">
        {() => <RequireAuth><Workspace /></RequireAuth>}
      </Route>
      <Route path="/songs/:songId">
        {() => <RequireAuth><SongHome /></RequireAuth>}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <>
      <Router />
      <Toaster />
    </>
  );
}

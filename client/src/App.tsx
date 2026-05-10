import { Switch, Route } from "wouter";
import Dashboard from "./pages/Dashboard";
import SongHome from "./pages/SongHome";
import Workspace from "./pages/Workspace";
import NotFound from "./pages/not-found";
import { Toaster } from "@/components/ui/toaster";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/songs/:songId" component={SongHome} />
      <Route path="/songs/:songId/workspace" component={Workspace} />
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

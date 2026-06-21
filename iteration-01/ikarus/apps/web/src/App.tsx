import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Shell } from "./components/Shell";
import { Spinner } from "./components/ui";
import { Login } from "./pages/Login";
import { Connections } from "./pages/Connections";
import { Models } from "./pages/Models";
import { Policies } from "./pages/Policies";
import { Runs } from "./pages/Runs";
import { RunDetailPage } from "./pages/RunDetail";
import { Connect } from "./pages/Connect";

export function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-[100dvh] place-items-center">
        <Spinner />
      </div>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/runs" element={<Runs />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
        <Route path="/connections" element={<Connections />} />
        <Route path="/policies" element={<Policies />} />
        <Route path="/models" element={<Models />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="*" element={<Navigate to="/runs" replace />} />
      </Route>
    </Routes>
  );
}

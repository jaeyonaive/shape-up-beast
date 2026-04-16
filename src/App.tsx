import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Tutorial from "./pages/Tutorial";
import Battle from "./pages/Battle";
import NotFound from "./pages/NotFound";
import { ErrorBoundary } from "./components/ErrorBoundary";

const queryClient = new QueryClient();

// GitHub Pages project pages are served from /shape-up-beast/; all other hosts
// (Netlify, Vercel, custom domains) serve from root.
const BASENAME = window.location.pathname.startsWith('/shape-up-beast') ? '/shape-up-beast' : '';

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter basename={BASENAME}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/tutorial" element={<Tutorial />} />
            <Route path="/battle/:monsterId" element={<Battle />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;

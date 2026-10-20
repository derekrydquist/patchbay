import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { DEMO_GUEST_ID, clearDemoWelcome, isDemoWelcomePending } from "@/lib/demo";

const THINGS_TO_TRY = [
  "Press play to hear the arrangement so far.",
  "Drag a version from the file browser onto the timeline.",
  "Open the Production tab to see what's left to record.",
  "Visit Home for the band's activity, and Library for its ideas.",
];

// Shown once after a demo login, on whatever page the visitor lands on. Any close
// (button, Escape, X, outside click) clears the flag, so refresh and navigation
// don't bring it back.
export function DemoWelcomeDialog() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(user?.id === DEMO_GUEST_ID && isDemoWelcomePending());
  }, [user?.id]);

  const handleOpenChange = (next: boolean) => {
    if (!next) clearDemoWelcome();
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-[#0c0c0e] border-primary/20 w-[calc(100%-2rem)] max-w-md rounded-lg max-h-[calc(100vh-2rem)] overflow-y-auto">
        <DialogHeader className="text-left">
          <DialogTitle className="text-sm uppercase tracking-widest font-heading">Welcome to PatchBay</DialogTitle>
          <DialogDescription className="text-sm text-white/70 leading-relaxed pt-1">
            PatchBay is where a band collects its recorded ideas, organizes them by track and section, and assembles them into a demo together.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">A few things to try:</p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-white/80 marker:text-primary">
            {THINGS_TO_TRY.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>

        <p className="text-xs text-white/40 leading-relaxed">
          Uploads are turned off in the demo, and other visitors may be exploring too. PatchBay works best in desktop Chrome.
        </p>

        <div className="flex justify-end">
          <Button
            onClick={() => handleOpenChange(false)}
            className="w-full sm:w-auto uppercase tracking-widest text-[10px] font-bold"
          >
            Start exploring
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
